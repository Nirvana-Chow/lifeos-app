'use client';

import {ArrowUpRight} from 'lucide-react';
import {useEffect, useState} from 'react';
import {Button} from './ui/button';
import {readRequirementItem} from '../requirements-candidate/client.ts';
import type {RequirementItem} from '../requirements-candidate/service.ts';
import {formatDeliveryTime, requirementDelivery} from './requirements-delivery.ts';
import styles from './requirement-progress-card.module.css';

function summarize(items: RequirementItem[], observedAt: string) {
  const counts = {not_implemented:0, in_progress:0, merged:0, live:0, blocked:0, unverified:0};
  for (const {requirement, fields} of items) {
    const {state} = requirementDelivery(requirement, fields.workflow);
    counts[state]++;
    if (fields.workflow?.state === 'blocked') counts.blocked++;
  }
  return {counts, observedAt};
}

export function RequirementProgressCard({scope, onOpen}: {scope: string; onOpen: () => void}) {
  const [summary, setSummary] = useState<ReturnType<typeof summarize> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let request: AbortController | undefined;
    async function refresh() {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const {signal} = controller;
      const options = {credentials:'same-origin', cache:'no-store', signal} as const;
      setSummary(null);
      setLoading(true);
      try {
        const status = await fetch('/api/platform/personal/status', options);
        if (!status.ok) return;
        const binding = await status.json();
        if (binding.requirementsEnabled !== true || JSON.stringify([binding.ownerId, binding.spaceId]) !== scope) return;
        const response = await fetch('/api/platform/personal/requirements/snapshot', options);
        if (!response.ok) return;
        const snapshot = await response.json();
        if (snapshot.scope !== 'full-current-requirements-snapshot' || snapshot.truncated !== false ||
            !Array.isArray(snapshot.items) || snapshot.total !== snapshot.items.length) return;
        const items: RequirementItem[] = snapshot.items.map(readRequirementItem);
        if (items.some(item => item.id !== item.requirement.id) || new Set(items.map(item => item.id)).size !== items.length) return;
        const observedAt = typeof snapshot.observedAt === 'string' && Number.isFinite(Date.parse(snapshot.observedAt))
          ? snapshot.observedAt : '';
        if (!signal.aborted) setSummary(summarize(items, observedAt));
      } catch {
        // Incomplete or unavailable reads leave the counters unknown.
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    }
    void refresh();
    window.addEventListener('focus', refresh);
    return () => { request?.abort(); window.removeEventListener('focus', refresh); };
  }, [scope]);

  const counts = summary?.counts;
  return <section className={`lo-panel ${styles.card}`} aria-label="需求进度">
    <div className="lo-panel-heading">
      <h2>需求进度</h2>
      <Button variant="ghost" aria-label="查看全部需求" data-workspace-nav onClick={onOpen}>
        查看全部<ArrowUpRight size={18} aria-hidden="true" />
      </Button>
    </div>
    {counts ? <>
      <dl className={styles.counts}>
        <div><dt>未开始</dt><dd>{counts.not_implemented}</dd></div>
        <div><dt>进行中</dt><dd>{counts.in_progress}</dd></div>
        <div><dt>待上线验收</dt><dd>{counts.merged}</dd></div>
        <div><dt>已上线</dt><dd>{counts.live}</dd></div>
        {counts.blocked > 0 && <div><dt>其中受阻</dt><dd>{counts.blocked}</dd></div>}
        {counts.unverified > 0 && <div><dt>待核实</dt><dd>{counts.unverified}</dd></div>}
      </dl>
      <p className={styles.date}>{summary.observedAt
        ? <>读取时间 <time dateTime={summary.observedAt}>{formatDeliveryTime(summary.observedAt)}</time>（北京时间）</>
        : '读取时间待核实'}</p>
    </> : <p className="lo-empty-compact" role="status">{loading ? '正在读取需求进度…' : '需求进度暂不可用'}</p>}
  </section>;
}
