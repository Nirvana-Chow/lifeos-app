'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { makePersonalCommand, PersonalMutationSession, type PersonalState } from '../personal-candidate/client';
import { Button } from '../ui-review/ui/button';
import type { CookingFields } from './log-domain';
import { CookingFrame } from './frame';
import { cookingStatusPath, parseCookingAccess, sameCookingBinding, type CookingAccess } from './log-access';
import { cookingLogRow, loadCookingHistory, readCookingRecord, sortCookingRows, type CookingLogRow } from './log-client';
import styles from './log-workbench.module.css';

type RecipeSeed = { id:string; name:string; sourceUrl:string };
type Editor = {
  row: CookingLogRow | null;
  fields: CookingFields;
  original: CookingFields;
};
type ActiveScope = {
  access: CookingAccess;
  session: PersonalMutationSession;
  unsubscribe: () => void;
};
const pageSize = 12;

function newEditor(recipe: RecipeSeed | null): Editor {
  const fields: CookingFields = {
    title:recipe?.name ?? '',
    text:'',
    occurredOn:'',
    personal:{ type:'cooking', schemaVersion:1, recipe:recipe ? {id:recipe.id,sourceUrl:recipe.sourceUrl} : null },
  };
  return { row:null, fields, original:fields };
}

function changed(editor: Editor | null) {
  return !!editor && JSON.stringify(editor.fields) !== JSON.stringify(editor.original);
}

function canLeave(editor: Editor | null, mutation: PersonalState | undefined) {
  if (mutation?.phase === 'saving' || mutation?.phase === 'uncertain' && mutation.pending?.type === 'cooking') return false;
  return !changed(editor) || window.confirm('放弃尚未保存的做饭记录修改？');
}

export function CookingHistoryPage({ recipe }: {recipe: RecipeSeed | null}) {
  const navigation = useRef<() => boolean>(() => true);
  return (
    <CookingFrame title="做饭历史" canNavigate={() => navigation.current()}>
      <CookingLogWorkbench recipe={recipe} navigation={navigation} />
    </CookingFrame>
  );
}

function CookingLogWorkbench({ recipe, navigation }: {
  recipe: RecipeSeed | null;
  navigation: {current: () => boolean};
}) {
  const [access, setAccess] = useState<CookingAccess | null>(null);
  const [rows, setRows] = useState<CookingLogRow[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [mutation, setMutation] = useState<PersonalState | undefined>(undefined);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [page, setPage] = useState(0);
  const active = useRef<ActiveScope | null>(null);
  const request = useRef<AbortController | null>(null);
  const currentEditor = useRef<Editor | null>(null);
  const retainedDraft = useRef<{access:CookingAccess; editor:Editor} | null>(null);
  const seededRecipe = useRef<string | null>(null);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const locked = busy || mutation?.phase === 'saving' || mutation?.phase === 'uncertain';
  const dirty = changed(editor);
  const ownPending = mutation?.phase === 'uncertain' && mutation.pending?.type === 'cooking';
  const otherPending = mutation?.phase === 'uncertain' && mutation.pending && mutation.pending.type !== 'cooking';
  const pageCount = Math.ceil(rows.length / pageSize);

  function setForm(next: Editor | null) {
    currentEditor.current = next;
    setEditor(next);
  }

  function detach() {
    const scope = active.current;
    active.current = null;
    request.current?.abort();
    request.current = null;
    scope?.unsubscribe();
    scope?.session.invalidateBinding();
  }

  function clearScope(retain: boolean) {
    if (retain && active.current && currentEditor.current) {
      retainedDraft.current = { access:active.current.access, editor:currentEditor.current };
    }
    if (!retain) retainedDraft.current = null;
    detach();
    setForm(null);
    setAccess(null);
    setRows([]);
    setMutation(undefined);
    setNotice('');
    setPage(0);
  }

  async function refresh() {
    clearScope(true);
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      const loaded = await loadCookingHistory(fetch, controller.signal);
      if (request.current !== controller || controller.signal.aborted) return;
      const verified = loaded.access;
      const session = new PersonalMutationSession({
        binding:{ownerId:verified.ownerId,spaceId:verified.spaceId},
        storage:window.localStorage,
        verifyReadback:true,
        assertBinding:() => sameCookingBinding(active.current?.access ?? null, verified)
          && document.visibilityState !== 'hidden',
        fetcher:async (input, init) => {
          const response = await fetch(input, init);
          if (input === cookingStatusPath && response.ok
            && !sameCookingBinding(parseCookingAccess(await response.clone().json()), verified)) {
            throw Error('记录能力或本人身份已变化。');
          }
          return response;
        },
      });
      const unsubscribe = session.subscribe(() => {
        if (active.current?.session === session) setMutation(session.getSnapshot());
      });
      active.current = { access:verified, session, unsubscribe };
      setAccess(verified);
      setRows(loaded.rows);
      const pending = session.getSnapshot();
      setMutation(pending);
      const draft = retainedDraft.current;
      retainedDraft.current = null;
      if (draft && sameCookingBinding(draft.access, verified)) {
        setForm(draft.editor);
      } else if (recipe && seededRecipe.current !== recipe.id && verified.writable && pending.phase !== 'uncertain') {
        seededRecipe.current = recipe.id;
        setForm(newEditor(recipe));
      }
    } catch (failure) {
      if (request.current === controller) {
        setError(failure instanceof Error ? failure.message : '无法核对做饭历史，请重试。');
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  useEffect(() => {
    navigation.current = () => canLeave(currentEditor.current, active.current?.session.getSnapshot());
    function hide() {
      clearScope(true);
      setBusy(true);
    }
    function visibility() {
      if (document.visibilityState === 'hidden') {
        hide();
      } else {
        void refresh();
      }
    }
    function restore(event: PageTransitionEvent) {
      if (event.persisted && document.visibilityState !== 'hidden') void refresh();
    }
    function warn(event: BeforeUnloadEvent) {
      const phase = active.current?.session.getSnapshot();
      if (changed(currentEditor.current) || phase?.phase === 'saving'
        || phase?.phase === 'uncertain' && phase.pending?.type === 'cooking') {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    visibility();
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', restore);
    window.addEventListener('beforeunload', warn);
    return () => {
      navigation.current = () => true;
      detach();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', restore);
      window.removeEventListener('beforeunload', warn);
    };
  }, [recipe, navigation]);

  useEffect(() => {
    if (editor) editorHeading.current?.focus();
  }, [editor?.row?.id, !!editor]);

  function begin() {
    if (!access?.writable || locked || !navigation.current()) return;
    setError('');
    setNotice('');
    setForm(newEditor(recipe));
  }

  async function open(expected: CookingLogRow) {
    const scope = active.current;
    if (!scope || request.current || locked || !navigation.current()) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const checked = await readCookingRecord(fetch, scope.access, expected, controller.signal);
      if (request.current !== controller || active.current !== scope) return;
      scope.access = checked.access;
      setAccess(checked.access);
      setForm({ row:checked.row, fields:checked.row.fields, original:checked.row.fields });
    } catch (failure) {
      if (request.current === controller) {
        clearScope(false);
        setBusy(false);
        setError(failure instanceof Error ? failure.message : '做饭记录读取失败，请重试。');
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  async function save(retry: boolean) {
    const scope = active.current;
    const form = currentEditor.current;
    if (!scope?.access.writable || request.current || scope.session.getSnapshot().phase === 'saving') return;
    setError('');
    setNotice('');
    try {
      if (retry) {
        if (scope.session.getSnapshot().pending?.type !== 'cooking') return;
        await scope.session.retry();
      } else {
        if (!form || scope.session.getSnapshot().phase === 'uncertain') return;
        const command = makePersonalCommand(
          {ownerId:scope.access.ownerId,spaceId:scope.access.spaceId}, 'cooking', form.row?.id ?? null, form.fields,
          'cooking-' + crypto.randomUUID(), true, form.row?.revision,
        );
        await scope.session.submit(command);
      }
      if (active.current !== scope) return;
      const result = scope.session.getSnapshot();
      if (result.phase !== 'saved' || !result.observed || !result.saved) return;
      const row = cookingLogRow(result.observed, scope.access.spaceId);
      setRows(previous => sortCookingRows([...previous.filter(item => item.id !== row.id), row]));
      setForm(null);
      setPage(0);
      setNotice(result.observed.revision > result.saved.revision
        ? '已核对本次保存。记录随后有更新，历史已显示较新的版本。'
        : '已保存这次做饭记录。');
    } catch (failure) {
      if (active.current === scope) {
        setError(failure instanceof Error ? failure.message : '保存未完成，请核对记录。');
      }
    }
  }

  function changePage(next: number) {
    setPage(next);
    historyHeading.current?.focus();
  }

  return (
    <div className={styles.workbench}>
      <div className={styles.toolbar}>
        <Link href="/personal/cooking" className={styles.link}>返回菜谱库</Link>
        {access?.writable && <Button type="button" disabled={locked} onClick={begin}>记录做饭</Button>}
        <Button type="button" variant="outline" disabled={locked || dirty} onClick={() => void refresh()}>重新读取</Button>
      </div>
      {busy && <p role="status">正在核对做饭记录…</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {mutation?.error && <p role="alert" className={styles.error}>{mutation.error}</p>}
      {mutation?.phase === 'saving' && <p role="status">正在保存并重新读取这次记录…</p>}
      {notice && <p role="status">{notice}</p>}
      {ownPending && <Button type="button" variant="outline" disabled={!access?.writable || busy}
        onClick={() => void save(true)}>继续确认上次保存</Button>}
      {otherPending && <p>另一类记录有待确认的保存，请到对应页面核对后再继续。</p>}

      {access && editor && (
        <section className={styles.panel} aria-labelledby="cooking-editor-heading">
          <h2 id="cooking-editor-heading" ref={editorHeading} tabIndex={-1}>
            {editor.row ? '这次做饭' : '记录这次做饭'}
          </h2>
          <form onSubmit={event => { event.preventDefault(); void save(false); }}>
            <fieldset className={styles.fields} disabled={locked || !access.writable}>
              <label>菜名<input required maxLength={240} value={editor.fields.title}
                onChange={event => setForm({...editor,fields:{...editor.fields,title:event.target.value}})} /></label>
              <label>做饭日期<input type="date" required value={editor.fields.occurredOn}
                onChange={event => setForm({...editor,fields:{...editor.fields,occurredOn:event.target.value}})} /></label>
              <label>做饭笔记（选填）<textarea rows={4} maxLength={16384} value={editor.fields.text}
                onChange={event => setForm({...editor,fields:{...editor.fields,text:event.target.value}})} /></label>
            </fieldset>
            {editor.fields.personal.recipe && <p className={styles.meta}>
              <a className={styles.link} href={editor.fields.personal.recipe.sourceUrl} target="_blank" rel="noreferrer">
                查看关联原菜谱
              </a>
            </p>}
            <div className={styles.toolbar}>
              {access.writable && <Button type="submit" disabled={locked || !!editor.row && !dirty}>确认保存</Button>}
              <Button type="button" variant="outline" disabled={locked} onClick={() => {
                if (navigation.current()) setForm(null);
              }}>{access.writable ? '取消' : '关闭'}</Button>
            </div>
          </form>
        </section>
      )}

      {access && (
        <section className={styles.panel} aria-labelledby="cooking-log-list-heading">
          <h2 id="cooking-log-list-heading" ref={historyHeading} tabIndex={-1}>做过的菜</h2>
          {rows.length ? (
            <ul className={styles.rows}>
              {rows.slice(page * pageSize, (page + 1) * pageSize).map(row => (
                <li key={row.id}>
                  <button type="button" className={styles.row} disabled={locked}
                    onClick={() => void open(row)}>
                    <strong>{row.fields.title}</strong><time dateTime={row.fields.occurredOn}>{row.fields.occurredOn}</time>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p>还没有做饭记录。</p>}
          {pageCount > 1 && <nav aria-label="做饭记录分页" className={styles.toolbar}>
            <Button type="button" variant="outline" disabled={page === 0} onClick={() => changePage(page - 1)}>上一页</Button>
            <span className={styles.meta} aria-live="polite">第 {page + 1} / {pageCount} 页</span>
            <Button type="button" variant="outline" disabled={page + 1 === pageCount} onClick={() => changePage(page + 1)}>下一页</Button>
          </nav>}
        </section>
      )}
      {access && <p className={styles.meta}>照片待接入。</p>}
    </div>
  );
}
