'use client';

import {useEffect, useRef, useState} from 'react';
import {workspaceHref} from '../workbench/private-navigation';
import {useOwnerPageVerification} from '../personal-candidate/privacy';
import type {readLifeOSDevelopmentProgress} from './development-project-progress';
import {deliveryLabels, formatDeliveryTime} from './requirements-delivery';
import {Button} from './ui/button';
import styles from './requirement-progress-card.module.css';

export function DevelopmentProjects() {
  const verified = useOwnerPageVerification();
  const [progress, setProgress] = useState<ReturnType<typeof readLifeOSDevelopmentProgress> | null>(null);
  const [loading, setLoading] = useState(true);
  const [summaryUnavailable, setSummaryUnavailable] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const hide = () => {
      request.current?.abort();
      request.current = null;
      setProgress(null);
      setSummaryUnavailable(false);
      setLoading(true);
    };
    const visibility = () => { if (document.visibilityState === 'hidden') hide(); };
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      request.current?.abort();
      request.current = null;
      window.removeEventListener('pagehide', hide);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  useEffect(() => {
    // Initial pageshow can temporarily recheck the privacy boundary. The same
    // document shares its pending read until it is hidden or leaves the route.
    if (verified !== true || request.current || document.visibilityState === 'hidden') return;
    const controller = new AbortController();
    request.current = controller;
    const {signal} = controller;
    async function load() {
      try {
        const response = await fetch('/api/platform/personal/requirements/development-progress', {
          credentials:'same-origin', cache:'no-store', signal,
        });
        if (!response.ok) {
          if (!signal.aborted && response.status === 503) setSummaryUnavailable(true);
          return;
        }
        const result = await response.json() as NonNullable<typeof progress>;
        if (!signal.aborted) setProgress(result);
      } catch {
        // Failed reads leave progress unavailable.
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    }
    queueMicrotask(() => { if (!signal.aborted) void load(); });
  }, [verified]);

  if (verified !== true) return null;

  return <section className={`lo-panel ${styles.card}`} aria-label="LifeOS 网站需求进度">
    <header className="lo-panel-heading">
      <h2>LifeOS 网站</h2>
      {(progress || summaryUnavailable) && <Button asChild variant="ghost" data-workspace-nav>
        <a href={workspaceHref('requirements')}>打开需求池</a>
      </Button>}
    </header>
    {progress ? <>
      <dl className={styles.counts}>
        {Object.entries(deliveryLabels).map(([state, label]) => <div key={state}>
          <dt>{label}</dt>
          <dd>{progress.counts[state as keyof typeof progress.counts]}</dd>
        </div>)}
      </dl>
      {progress.observedAt && <p className={styles.date}>
        读取时间 <time dateTime={progress.observedAt}>{formatDeliveryTime(progress.observedAt)}</time>（北京时间）
      </p>}
    </> : <p className="lo-empty-compact" role="status">
      {loading ? '正在读取需求进度…' : '需求进度暂不可用。'}
    </p>}
  </section>;
}
