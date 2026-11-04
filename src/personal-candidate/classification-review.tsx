'use client';
import {useCallback, useEffect, useRef, useState} from 'react';
import type {ClassificationReview as Review} from './classification-contracts';
import type {PersonalRelations} from './business';
import {Dialog, DialogContent, DialogTitle} from '../ui-review/ui/dialog';
import {Button} from '../ui-review/ui/button';
import s from './classification-review.module.css';

type Phase = 'idle' | 'busy' | 'approval-unknown' | 'commit-unknown' | 'conflict' | 'auth';
type Props = {
  planId: string;
  onClose: () => void;
  onPlanChange: (id: string) => void;
  container: HTMLElement | null;
  closeGuard: {current: (() => boolean) | null};
};

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
}

async function commandKey(planId: string, digest: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([planId, digest])));
  return 'cls-' + Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('');
}

function ReferenceDetails({label, relations}: {label: string; relations: PersonalRelations | null}) {
  const references = relations ? [
    ...(relations.project ? [{label: '项目', ref: relations.project}] : []),
    ...(relations.domain ? [{label: '领域', ref: relations.domain}] : []),
    ...relations.topics.map(ref => ({label: '主题', ref})),
  ] : [];
  return <div><strong>{label}</strong>{references.length === 0 ? <p>未分类</p> : references.map(({label: kind, ref}, index) =>
    <div key={kind + ref.id + index}>
      <p>{kind} ID：{ref.id}</p>
      <p>{kind} 来源 ID：{ref.sourceId}</p>
      <p>{kind} 版本：{ref.revision}</p>
    </div>)}
  </div>;
}

export function ClassificationReview({planId, onClose, onPlanChange, container, closeGuard}: Props) {
  const [review, setReview] = useState<Review | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [full, setFull] = useState(false);
  const [reading, setReading] = useState(false);
  const [readback, setReadback] = useState<Record<string, string>>({});
  const initialFocus = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null);
  const recoverCommit = useRef(false);
  const activeCommand = useRef<AbortController | null>(null);
  const activeRead = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const phaseRef = useRef<Phase>('idle');
  const base = '/api/platform/personal/todo-classifications/' + planId;

  const updatePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);
  // Every command, read, plan change or unmount fences all prior async work.
  const beginOperation = useCallback(() => {
    generation.current++;
    activeRead.current?.abort();
    activeRead.current = null;
    setReading(false);
    return generation.current;
  }, []);
  const isCurrent = useCallback((token: number) => generation.current === token, []);

  useEffect(() => {
    closeGuard.current = () => !['busy', 'approval-unknown', 'commit-unknown'].includes(phaseRef.current);
    return () => { closeGuard.current = null; };
  }, [closeGuard]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (['busy', 'approval-unknown', 'commit-unknown'].includes(phaseRef.current)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const refresh = useCallback(async (preserveUnknown = false) => {
    if (activeRead.current) return null;
    const token = beginOperation();
    const controller = new AbortController();
    activeRead.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 30000);
    setReading(true);
    try {
      const response = await fetch(base, {cache: 'no-store', credentials: 'same-origin', signal: controller.signal});
      if (!isCurrent(token)) return null;
      if (response.status === 401 || response.status === 403) {
        recoverCommit.current = preserveUnknown || phaseRef.current === 'commit-unknown';
        setReview(null);
        setReadback({});
        updatePhase('auth');
        setMessage('请重新登录后继续核对。');
        return null;
      }
      if (!response.ok) throw Error();
      const data: Review = await response.json();
      if (!isCurrent(token)) return null;
      setReview(data);
      setSelected(data.preview.changes.map(change => change.todo.id));
      if (data.receipt) {
        recoverCommit.current = false;
        updatePhase('idle');
        setMessage('已提交，正在核对当前记录。');
        const pairs = await Promise.all(data.receipt.entries.map(async expected => {
          try {
            const result = await fetch('/api/platform/personal/todo/' + expected.id, {
              cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
            });
            if (!result.ok) throw Error();
            const {entry} = await result.json();
            const matches = entry?.source?.id === expected.sourceId && entry?.revision === expected.revision &&
              canonical(entry?.draft?.personal) === canonical(expected.personal);
            return [expected.id, matches ? '已核对' : '提交后有变化'] as const;
          } catch {
            return [expected.id, '无法读取'] as const;
          }
        }));
        if (isCurrent(token)) setReadback(Object.fromEntries(pairs));
      } else if (preserveUnknown || recoverCommit.current) {
        updatePhase('commit-unknown');
        recoverCommit.current = true;
        setMessage('尚未读到提交结果，原请求可能仍在处理。');
      } else {
        updatePhase('idle');
        setMessage(data.stale ? '内容已变化，不能按此预览提交。' : '');
      }
      return data;
    } catch {
      if (isCurrent(token)) setMessage('读取失败，请重新读取。');
      return null;
    } finally {
      window.clearTimeout(timer);
      if (activeRead.current === controller) {
        activeRead.current = null;
        if (isCurrent(token)) setReading(false);
      }
    }
  }, [base, beginOperation, isCurrent, updatePhase]);

  useEffect(() => {
    setReview(null);
    updatePhase('idle');
    setReadback({});
    void refresh();
    return () => {
      generation.current++;
      activeRead.current?.abort();
      activeRead.current = null;
      activeCommand.current?.abort();
      activeCommand.current = null;
    };
  }, [refresh, updatePhase]);

  async function post(action: 'approve' | 'commit' | 'preview', body: unknown, key?: string, signal?: AbortSignal) {
    return fetch(base + '/' + action, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
      headers: {'content-type': 'application/json', ...(key ? {'idempotency-key': key} : {})},
      body: JSON.stringify(body),
    });
  }
  function concealForAuth(commitUnknown = false) {
    if (commitUnknown) recoverCommit.current = true;
    setReview(null);
    setReadback({});
    updatePhase('auth');
    setMessage('请重新登录后继续核对。');
  }

  async function submit(retry = false) {
    if (!review || (retry ? phaseRef.current !== 'commit-unknown' : phaseRef.current !== 'idle')) return;
    const token = beginOperation();
    const controller = new AbortController();
    activeCommand.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 30000);
    const body = {digest: review.preview.digest, confirmed: true};
    updatePhase('busy');
    setMessage('正在处理，请稍候。');
    let committing = retry || !!review.approval;
    try {
      if (!review.approval && !retry) {
        const approval = await post('approve', body, undefined, controller.signal);
        if (!isCurrent(token)) return;
        if (approval.status === 401 || approval.status === 403) { concealForAuth(); return; }
        if (approval.status === 409) { updatePhase('conflict'); setMessage('审核内容已变化，请重新读取。'); return; }
        if (!approval.ok) { updatePhase('approval-unknown'); setMessage('批准结果未确认，请先读取状态。'); return; }
      }
      committing = true;
      const key = await commandKey(planId, review.preview.digest);
      if (!isCurrent(token)) return;
      const result = await post('commit', body, key, controller.signal);
      if (!isCurrent(token)) return;
      if (result.status === 401 || result.status === 403) { concealForAuth(true); return; }
      if (result.status === 409) { updatePhase('conflict'); setMessage('提交冲突，请读取结果；不会替换原内容。'); return; }
      if (!result.ok) { updatePhase('commit-unknown'); setMessage('提交结果未确认，请读取结果或重试同一请求。'); return; }
      updatePhase('commit-unknown');
      await refresh(true);
    } catch {
      if (isCurrent(token)) {
        updatePhase(committing ? 'commit-unknown' : 'approval-unknown');
        setMessage('结果未确认，请先读取状态。');
      }
    } finally {
      window.clearTimeout(timer);
      if (activeCommand.current === controller) activeCommand.current = null;
    }
  }

  async function subset() {
    if (!review || phaseRef.current !== 'idle' || !selected.length || selected.length === review.preview.changes.length) return;
    const token = beginOperation();
    const controller = new AbortController();
    activeCommand.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 30000);
    updatePhase('busy');
    setMessage('正在生成预览，请稍候。');
    try {
      const response = await post('preview', {selectedTodoIds: selected}, undefined, controller.signal);
      if (!isCurrent(token)) return;
      if (response.status === 401 || response.status === 403) { concealForAuth(); return; }
      if (!response.ok) throw Error();
      const preview = await response.json();
      if (!isCurrent(token)) return;
      if (typeof preview.planId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(preview.planId)) throw Error();
      const check = await fetch('/api/platform/personal/todo-classifications/' + preview.planId, {
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      });
      if (!isCurrent(token)) return;
      if (check.status === 401 || check.status === 403) { concealForAuth(); return; }
      if (!check.ok) throw Error();
      const confirmed = await check.json();
      if (!isCurrent(token)) return;
      if (confirmed?.preview?.planId !== preview.planId) throw Error();
      onPlanChange(preview.planId);
    } catch {
      if (isCurrent(token)) {
        updatePhase('idle');
        setMessage('新预览未确认；当前审核内容保持不变。');
      }
    } finally {
      window.clearTimeout(timer);
      if (activeCommand.current === controller) activeCommand.current = null;
    }
  }

  const labels = review?.labels;
  const name = (id: string) => labels?.organization.find(item => item.id === id)?.title ?? '未找到的分类';
  const relations = (value: PersonalRelations | null) => value ? [
    value.project && '项目：' + name(value.project.id),
    value.domain && '领域：' + name(value.domain.id),
    ...value.topics.map(item => '主题：' + name(item.id)),
  ].filter(Boolean).join('、') || '未分类' : '未分类';
  const locked = phase !== 'idle' || !!review?.approval || !!review?.receipt || !!review?.stale;

  return <Dialog open onOpenChange={open => { if (!open && closeGuard.current?.() !== false) onClose(); }}>
    <DialogContent container={container} className={`${s.dialog} ${full ? s.full : ''}`} aria-describedby={undefined}
      onCloseAutoFocus={event => {
        event.preventDefault();
        queueMicrotask(() => {
          const opener = initialFocus.current;
          if (opener && opener !== document.body && opener.isConnected && !opener.matches(':disabled')) {
            opener.focus({preventScroll: true});
            if (document.activeElement === opener) return;
          }
          document.querySelector<HTMLElement>('#personal-main h1')?.focus({preventScroll: true});
        });
      }}
      onEscapeKeyDown={event => { if (closeGuard.current?.() === false) event.preventDefault(); }}
      onPointerDownOutside={event => { if (closeGuard.current?.() === false) event.preventDefault(); }}>
      <header className={s.header}>
        <DialogTitle>审核待办分类</DialogTitle>
        <Button variant="outline" onClick={() => setFull(!full)}>{full ? '恢复窗口' : '展开全屏'}</Button>
      </header>
      {message && <p role="status">{message}</p>}
      {phase === 'busy' && activeCommand.current && <Button variant="outline" onClick={() => activeCommand.current?.abort()}>停止等待</Button>}
      {!review && phase === 'idle' && message && <Button variant="outline" disabled={reading} onClick={() => void refresh()}>重新读取</Button>}
      {phase === 'auth' && <p>登录后可使用以下地址继续读取。
        <input readOnly aria-label="审核地址" value={typeof window === 'undefined' ? '' : window.location.href}/>
        <a href="/login" target="_blank" rel="noopener noreferrer" data-classification-reauth="">在新标签登录</a>{' '}
        <Button variant="outline" disabled={reading} onClick={() => void refresh(recoverCommit.current)}>重新读取</Button>
      </p>}
      {review && <>
        <p>共 {review.preview.changes.length} 条，其中 {review.preview.unchangedIds.length} 条没有变化。有效期至 {new Date(review.preview.expiresAt).toLocaleString()}。只会调整分类关系。名称显示当前值。</p>
        {review.approval && !review.receipt && <p>已批准。关闭审核不会撤销已有批准。</p>}
        <div className={s.list}>{review.preview.changes.map(change => <section className={s.item} key={change.todo.id}>
          <div className={s.itemTitle}>
            <label><input type="checkbox" checked={selected.includes(change.todo.id)} disabled={locked}
              onChange={event => setSelected(event.target.checked ? [...selected, change.todo.id] : selected.filter(id => id !== change.todo.id))}/>{' '}
              {labels?.todos.find(item => item.id === change.todo.id)?.title ?? '未找到的待办'}</label>
            {readback[change.todo.id] && <span>{readback[change.todo.id]}</span>}
          </div>
          <div className={s.diff}><p><small>原分类</small>{relations(change.before)}</p><p><small>调整后</small>{relations(change.after)}</p></div>
          <details><summary>查看记录信息</summary>
            <p>待办 ID：{change.todo.id}</p><p>待办来源 ID：{change.todo.sourceId}</p><p>待办版本：{change.todo.expectedRevision}</p>
            <ReferenceDetails label="原分类" relations={change.before}/><ReferenceDetails label="调整后" relations={change.after}/>
          </details>
        </section>)}</div>
        {['approval-unknown', 'commit-unknown'].includes(phase) && <p>可保留此地址以便稍后回来：
          <input readOnly aria-label="审核地址" value={typeof window === 'undefined' ? '' : window.location.href}/>
        </p>}
        <footer className={s.actions}>
          {!locked && selected.length > 0 && selected.length < review.preview.changes.length && <Button variant="outline" onClick={subset}>为所选待办生成新预览</Button>}
          {!locked && selected.length === review.preview.changes.length && <Button onClick={() => void submit()}>确认并提交</Button>}
          {review.approval && !review.receipt && phase === 'idle' && !review.stale && <Button onClick={() => void submit()}>提交已批准的分类</Button>}
          {['approval-unknown', 'commit-unknown', 'conflict'].includes(phase) && <Button disabled={reading} onClick={() => void refresh(phase === 'commit-unknown')}>读取结果</Button>}
          {phase === 'commit-unknown' && <Button variant="outline" onClick={() => void submit(true)}>重试同一请求</Button>}
          {['approval-unknown', 'commit-unknown'].includes(phase) && <Button variant="outline" onClick={() => { beginOperation(); updatePhase('idle'); onClose(); }}>关闭并稍后返回</Button>}
        </footer>
      </>}
    </DialogContent>
  </Dialog>;
}
