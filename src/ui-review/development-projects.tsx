'use client';

import {useEffect, useState} from 'react';
import {workspaceHref} from '../workbench/private-navigation';
import {useOwnerPageVerification} from '../personal-candidate/privacy';
import {readLifeOSDevelopmentProgress} from './development-project-progress';
import {verifiedModuleScope} from './owner-modules';
import {deliveryLabels, formatDeliveryTime} from './requirements-delivery';
import {Button} from './ui/button';
import styles from './requirement-progress-card.module.css';

async function readPersonal(path: string, signal: AbortSignal) {
  const response = await fetch('/api/platform/personal/' + path, {credentials:'same-origin', cache:'no-store', signal});
  if (!response.ok) throw Error('读取失败。');
  return response.json();
}

export function DevelopmentProjects() {
  return useOwnerPageVerification() === true ? <VerifiedDevelopmentProjects /> : null;
}

function VerifiedDevelopmentProjects() {
  const [progress, setProgress] = useState<ReturnType<typeof readLifeOSDevelopmentProgress> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let request: AbortController | undefined;
    async function refresh() {
      request?.abort();
      request = new AbortController();
      const {signal} = request;
      setProgress(null);
      setLoading(true);
      try {
        const status = await readPersonal('status', signal);
        const scope = verifiedModuleScope(status);
        if (!scope || status.requirementsEnabled !== true) return;
        const snapshot = await readPersonal('requirements/snapshot', signal);
        const result = readLifeOSDevelopmentProgress(snapshot);
        const after = await readPersonal('status', signal);
        if (!signal.aborted && verifiedModuleScope(after) === scope && after.requirementsEnabled === true) {
          setProgress(result);
        }
      } catch {
        // Failed and partial reads retain an unavailable state.
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    }
    void refresh();
    window.addEventListener('focus', refresh);
    return () => {
      request?.abort();
      window.removeEventListener('focus', refresh);
    };
  }, []);

  return <section className={`lo-panel ${styles.card}`} aria-label="LifeOS 网站需求进度">
    <header className="lo-panel-heading">
      <h2>LifeOS 网站</h2>
      {progress && <Button asChild variant="ghost" data-workspace-nav>
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
