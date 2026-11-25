'use client';

import {ArrowUpRight} from 'lucide-react';
import {useEffect, useState} from 'react';
import {Button} from './ui/button';
import {readRequirementsSnapshot} from '../requirements-candidate/client.ts';
import type {RequirementItem} from '../requirements-candidate/service.ts';
import {formatDeliveryTime, requirementDelivery, requirementIsComplete} from './requirements-delivery.ts';
import styles from './requirement-progress-card.module.css';

const workflowLabels = {
  planned:'计划',in_progress:'推进中',awaiting_review:'工程审查',blocked:'受阻',done:'标记开发完成',unrecorded:'未标记',
} as const;
const deliveryLabels = {
  unconfirmed:'交付证据待核实',merged:'已合并待上线',awaitingAcceptance:'已上线待本人验收',completed:'已上线且本人验收',
} as const;

function summarize(items: RequirementItem[], observedAt: string) {
  const workflow = {planned:0,in_progress:0,awaiting_review:0,blocked:0,done:0,unrecorded:0};
  const delivery = {unconfirmed:0,merged:0,awaitingAcceptance:0,completed:0};
  for (const {requirement, fields} of items) {
    workflow[fields.workflow?.state ?? 'unrecorded']++;
    const evidence = requirementDelivery(requirement);
    if (evidence.state === 'merged') delivery.merged++;
    else if (evidence.state === 'live') {
      delivery[requirementIsComplete(requirement, evidence) ? 'completed' : 'awaitingAcceptance']++;
    } else delivery.unconfirmed++;
  }
  return {workflow, delivery, observedAt, total:items.length};
}

export function RequirementProgressCard({scope, onOpen}: {scope: string; onOpen: () => void}) {
  const [reading, setReading] = useState<{scope:string; summary:ReturnType<typeof summarize>|null} | null>(null);
  const summary = reading?.scope===scope ? reading.summary : null;

  useEffect(() => {
    let request: AbortController | undefined;
    async function refresh() {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      const {signal} = controller;
      const options = {credentials:'same-origin', cache:'no-store', signal} as const;
      let next:ReturnType<typeof summarize>|null = null;
      try {
        const status = await fetch('/api/platform/personal/status', options);
        if (!status.ok) return;
        const binding = await status.json();
        if (binding.requirementsEnabled !== true || JSON.stringify([binding.ownerId, binding.spaceId]) !== scope) return;
        const response = await fetch('/api/platform/personal/requirements/snapshot', options);
        if (!response.ok) return;
        const snapshot = readRequirementsSnapshot(await response.json());
        const observedAt = typeof snapshot.observedAt === 'string' && Number.isFinite(Date.parse(snapshot.observedAt))
          ? snapshot.observedAt : '';
        next = summarize(snapshot.items, observedAt);
      } catch {
        // Incomplete or unavailable reads leave the counters unknown.
      } finally {
        if (!signal.aborted) setReading({scope,summary:next});
      }
    }
    void refresh();
    window.addEventListener('focus', refresh);
    return () => { request?.abort(); window.removeEventListener('focus', refresh); };
  }, [scope]);

  return <section className={`lo-panel ${styles.card}`} aria-label="需求进度">
    <div className="lo-panel-heading">
      <h2>需求进度</h2>
      <Button variant="ghost" aria-label="查看全部需求" data-workspace-nav onClick={onOpen}>
        查看全部<ArrowUpRight size={18} aria-hidden="true" />
      </Button>
    </div>
    {summary ? <>
      {summary.total===0 ? <p className="lo-empty-compact" role="status">暂无需求。</p> : <>
        <h3 className={styles.dimension}>推进状态（需求池标记）</h3>
        <dl className={styles.counts} aria-label="推进状态">
          {Object.entries(summary.workflow).filter(([key,count])=>key!=='unrecorded'||count>0)
            .map(([key,count])=><div key={key}><dt>{workflowLabels[key as keyof typeof workflowLabels]}</dt><dd>{count}</dd></div>)}
        </dl>
        <h3 className={styles.dimension}>交付证据</h3>
        <dl className={styles.counts} aria-label="交付证据">
          {Object.entries(summary.delivery)
            .map(([key,count])=><div key={key}><dt>{deliveryLabels[key as keyof typeof deliveryLabels]}</dt><dd>{count}</dd></div>)}
        </dl>
      </>}
      <p className={styles.date}>{summary.total>0 && <>待处理 {summary.total-summary.delivery.completed} / {summary.total} 项 · </>}{summary.observedAt
        ? <>读取时间 <time dateTime={summary.observedAt}>{formatDeliveryTime(summary.observedAt)}</time>（北京时间）</>
        : '读取时间待核实'}</p>
    </> : <p className="lo-empty-compact" role="status">{reading?.scope!==scope ? '正在读取需求进度…' : '需求进度暂不可用'}</p>}
  </section>;
}
