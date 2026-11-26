'use client';

import {useEffect, useRef, useState} from 'react';
import {Button} from '../ui-review/ui/button';
import {Input} from '../ui-review/ui/input';
import {useOwnerPageVerification} from '../personal-candidate/privacy';
import type {CardView, Command, Receipt, Review, Snapshot} from './domain';
import styles from './workspace.module.css';

const endpoint = '/personal/learning/data';
type Data = Snapshot & {writable: boolean; scope: string};
type Pending = {command: Command; key: string; scope: string};
const labels = {again:'再练', recalled:'记得'};
class RequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

async function load<T>(path = '', request?: RequestInit): Promise<T> {
  const result = await fetch(endpoint + path, {cache:'no-store', ...request});
  const data = await result.json();
  if (!result.ok) throw new RequestError(result.status, data.error?.code, data.error?.message ?? '读取失败。');
  return data;
}

export function LearningWorkspace() {
  const verified = useOwnerPageVerification();
  const [view, setView] = useState<Data | null>(null);
  const [busy, setBusy] = useState(true);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);
  const epoch = useRef(0);
  const writing = useRef(false);
  const frozen = useRef<Pending | null>(null);

  useEffect(() => {
    let controller: AbortController;
    function refresh() {
      controller?.abort();
      const id = ++epoch.current;
      setView(null);setRevealed(null);setPending(null);setNotice('');setBusy(true);setError('');
      setFront('');setBack('');
      if (verified !== true || document.visibilityState !== 'visible') return;
      controller = new AbortController();
      void load<Data>('', {signal:controller.signal}).then(data => {
        if (id !== epoch.current) return;
        setView(data);
        if (frozen.current?.scope === data.scope && data.writable) {
          setPending(frozen.current);
          setError('保存结果尚未确认。可在当前页面重试原请求。');
        } else {
          frozen.current = null;
        }
      }).catch(reason => {
        if (id === epoch.current) setError(reason.message);
      }).finally(() => {
        if (id === epoch.current) setBusy(false);
      });
    }
    refresh();
    document.addEventListener('visibilitychange', refresh);
    return () => {epoch.current++;controller?.abort();document.removeEventListener('visibilitychange', refresh);};
  }, [verified]);

  async function send(command: Command, retained?: Pending) {
    if (verified !== true || !view?.writable || busy || writing.current || (pending && !retained)) return;
    const id = epoch.current;
    const original = retained ?? {command, key:'learning-'+crypto.randomUUID(), scope:view.scope};
    if (original.scope !== view.scope) return;
    frozen.current = original;
    writing.current = true;setBusy(true);setError('');setNotice('');
    try {
      const receipt = await load<Receipt>('', {
        method:'POST', headers:{'content-type':'application/json', 'idempotency-key':original.key, 'x-learning-scope':original.scope},
        body:JSON.stringify(original.command),
      });
      if (id !== epoch.current) return;
      const query = new URLSearchParams({card:receipt.cardId});
      if (receipt.kind === 'review') query.set('review', receipt.id);
      const proof = await load<CardView & {review: Review | null; scope: string}>('?'+query);
      if (proof.scope !== original.scope) throw new RequestError(403, 'LEARNING_ACCESS_CHANGED', '词卡权限已变化。');
      if (proof.card.id !== receipt.cardId ||
          (command.kind === 'review' ? receipt.kind !== 'review' || receipt.cardId !== command.cardId ||
            proof.review?.id !== receipt.id || proof.review.rating !== command.rating ||
            proof.review.previousId !== command.previousId || proof.review.cardRevision !== command.cardRevision :
            receipt.kind !== 'card' || receipt.id !== proof.card.id ||
            proof.card.front !== command.front.trim() || proof.card.back !== command.back.trim())) {
        throw new Error('保存回执与独立读取不一致。');
      }
      const next = await load<Data>();
      if (id !== epoch.current) return;
      if (next.scope !== original.scope) throw new RequestError(403, 'LEARNING_ACCESS_CHANGED', '词卡权限已变化。');
      const current = next.cards.find(item => item.card.id === receipt.cardId);
      if (!current || (receipt.kind === 'review' && !current.history.some(item => item.id === receipt.id))) {
        throw new Error('复习投影尚未核对。');
      }
      frozen.current = null;
      setView(next);setPending(null);setRevealed(null);
      if (command.kind === 'create') {setFront('');setBack('');}
      setNotice(command.kind === 'create' ? '词卡已保存。' : '复习已保存。');
    } catch (reason) {
      if (id !== epoch.current) return;
      if (reason instanceof RequestError && [401,403].includes(reason.status)) {
        frozen.current = null;
        setView(null);setPending(null);setRevealed(null);setFront('');setBack('');
        setError('请重新验证词卡访问权限。');
      } else if (!retained && reason instanceof RequestError && reason.status === 409 &&
          reason.code === 'LEARNING_REVISION_CONFLICT') {
        frozen.current = null;
        setError('复习记录已更新，请重新读取。');
        setRevealed(null);
        try {
          const next = await load<Data>();
          if (id === epoch.current) setView(next.scope === original.scope ? next : null);
        } catch {
          if (id === epoch.current) setView(null);
        }
      } else if (!retained && reason instanceof RequestError && reason.status === 400) {
        frozen.current = null;
        setError(reason.message);
      } else {
        setPending(original);setError('保存结果尚未确认。可在当前页面重试原请求。');
      }
    } finally {
      writing.current = false;
      if (id === epoch.current) setBusy(false);
    }
  }

  if (verified !== true) return null;
  return <div className={styles.workspace}>
    {busy && !view && <p role="status">正在读取词卡…</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {pending && <div><Button type="button" variant="outline" disabled={busy}
      onClick={()=>void send(pending.command,pending)}>重试原请求</Button></div>}
    {view && <>
      {view.writable && <form className={styles.section}
        onSubmit={event=>{event.preventDefault();void send({kind:'create',confirmed:true,front,back});}}>
        <h2>新建词卡</h2>
        <label>词条<Input value={front} onChange={event=>setFront(event.target.value)} maxLength={240} required disabled={busy||!!pending}/></label>
        <label>释义<textarea value={back} onChange={event=>setBack(event.target.value)} maxLength={4000} required disabled={busy||!!pending}/></label>
        <div><Button disabled={busy||!!pending}>创建词卡</Button></div>
      </form>}
      <section className={styles.section} aria-label="词卡">
        <h2>词卡</h2>
        <p>已到期 {view.dueCardIds.length} 张</p>
        {view.cards.length === 0 && <p>还没有词卡。</p>}
        <div className={styles.cards}>
          {[...view.cards].sort((a,b)=>{
            const aDue=view.dueCardIds.indexOf(a.card.id),bDue=view.dueCardIds.indexOf(b.card.id);
            return (aDue<0?Infinity:aDue)-(bDue<0?Infinity:bDue) || a.card.id.localeCompare(b.card.id);
          }).map(({card, history, schedule})=>{
            const latest = history.at(-1);
            const reviewing = revealed === card.id;
            return <article key={card.id} aria-label={card.front}>
              <h3>{card.front}</h3>
              {latest && schedule ? <>
                <p>最近复习：{labels[latest.rating]}</p>
                <p>下次到期 <time dateTime={schedule.nextDueAt}>{new Intl.DateTimeFormat('zh-CN',{
                  dateStyle:'medium',timeStyle:'short',
                }).format(new Date(schedule.nextDueAt))}</time></p>
              </> : <p>掌握度未知 · 尚未复习</p>}
              <div className={styles.actions}>
                {reviewing ? <>
                  <p>{card.back}</p>
                  {view.writable && (['again','recalled'] as const).map(rating=><Button key={rating} type="button" variant="outline"
                    disabled={busy||!!pending} onClick={()=>void send({kind:'review',confirmed:true,cardId:card.id,
                      cardRevision:card.revision,previousId:latest?.id??null,rating})}>{labels[rating]}</Button>)}
                </> : <Button type="button" disabled={busy||!!pending} variant="outline"
                  onClick={()=>setRevealed(card.id)}>{view.writable ? '查看释义并复习' : '查看释义'}</Button>}
              </div>
              {history.length > 0 && <details><summary>复习历史（{history.length}）</summary>
                <ol className={styles.history}>{[...history].reverse().map(review=><li key={review.id}>
                  {labels[review.rating]} · <time dateTime={review.reviewedAt}>{new Intl.DateTimeFormat('zh-CN',{
                    dateStyle:'medium',timeStyle:'short',
                  }).format(new Date(review.reviewedAt))}</time>
                </li>)}</ol>
              </details>}
            </article>;
          })}
        </div>
      </section>
    </>}
  </div>;
}
