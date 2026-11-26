'use client';

import {useEffect, useState} from 'react';
import {workspaceHref} from '../workbench/private-navigation';
import {useOwnerPageVerification} from '../personal-candidate/privacy';
import type {readLifeOSDevelopmentProgress} from './development-project-progress';
import {deliveryLabels, formatDeliveryTime} from './requirements-delivery';
import {Button} from './ui/button';
import styles from './requirement-progress-card.module.css';

type DevelopmentProgress = ReturnType<typeof readLifeOSDevelopmentProgress>;

export function DevelopmentProjects() {
  const verified = useOwnerPageVerification();
  const [pageShown, setPageShown] = useState(false);
  const [reading, setReading] = useState<{progress: DevelopmentProgress | null} | null>();

  useEffect(() => {
    let frame: number | undefined;
    // Let React commit the privacy boundary's pageshow check before we read.
    const show = () => { frame = window.requestAnimationFrame(() => setPageShown(true)); };
    const navigation = window.performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
    const loadFinished = navigation ? navigation.loadEventEnd > 0 : document.readyState === 'complete';
    if (loadFinished) show();
    else window.addEventListener('pageshow', show, {once:true});
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      window.removeEventListener('pageshow', show);
    };
  }, []);

  useEffect(() => {
    if (!pageShown || verified !== true || document.visibilityState === 'hidden') {
      setReading(undefined);
      return;
    }
    const controller = new AbortController();
    const {signal} = controller;
    const hide = () => {
      controller.abort();
      setReading(undefined);
    };
    const visibility = () => { if (document.visibilityState === 'hidden') hide(); };
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', visibility);

    async function load() {
      let result: NonNullable<typeof reading> | null = null;
      try {
        const response = await fetch('/api/platform/personal/requirements/development-progress', {
          credentials:'same-origin', cache:'no-store', signal,
        });
        if (response.ok) {
          result = {progress:await response.json() as DevelopmentProgress};
        } else if (response.status === 503) {
          const failure = await response.json();
          // The existing owner guard runs before the summary's storage check.
          if (failure?.error?.code === 'PERSONAL_STORAGE_UNAVAILABLE') result = {progress:null};
        }
      } catch {
        // Failed reads leave progress unavailable.
      } finally {
        if (!signal.aborted) setReading(result);
      }
    }
    void load();
    return () => {
      controller.abort();
      window.removeEventListener('pagehide', hide);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [pageShown, verified]);

  if (verified !== true) return null;

  const progress = reading?.progress;
  return <section className={`lo-panel ${styles.card}`} aria-label="LifeOS 网站需求进度">
    <header className="lo-panel-heading">
      <h2>LifeOS 网站</h2>
      {reading && <Button asChild variant="ghost" data-workspace-nav>
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
      {reading === undefined ? '正在读取需求进度…' : '需求进度暂不可用。'}
    </p>}
  </section>;
}
