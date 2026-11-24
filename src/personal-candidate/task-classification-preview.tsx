'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {Button} from '../ui-review/ui/button';
import type {PublicEntry} from '../platform/contracts';
import {validateTodo} from '../platform/domain';
import {PersonalWorkspaceController} from './workspace-controller';
import type {PersonalReference} from './business';
import styles from './task-classification-preview.module.css';

type Proposal = {project: string; topics: string[]};
const pageSize = 20;
const noEntries: readonly PublicEntry[] = [];

export function TaskClassificationPreview() {
  const host = useRef<PersonalWorkspaceController | null>(null);
  const [entries, setEntries] = useState<readonly PublicEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draftEpoch, setDraftEpoch] = useState(0);
  useEffect(() => {
    const controller = new PersonalWorkspaceController({
      fetcher: (url, init) => fetch(url, init), origin: window.location.origin,
      today: () => new Date().toLocaleDateString('sv-SE'), key: () => crypto.randomUUID(),
    });
    host.current = controller;
    let confirmedSnapshot: string | null = null;
    const stop = controller.subscribe(() => {
      const {state} = controller.getSnapshot();
      const next = controller.getClassificationEntries();
      const binding = controller.getEditorBinding();
      if (next && binding) {
        const identity = JSON.stringify([binding.ownerId, binding.spaceId,
          next.map(entry => [entry.id, entry.source.id, entry.revision]).sort((a, b) =>
            String(a[0]).localeCompare(String(b[0])))]);
        if (confirmedSnapshot !== null && identity !== confirmedSnapshot) {
          setDraftEpoch(epoch => epoch + 1);
        }
        confirmedSnapshot = identity;
      } else if (state.status === 'forbidden' && confirmedSnapshot !== null) {
        confirmedSnapshot = null;
        setDraftEpoch(epoch => epoch + 1);
      }
      setEntries(next);
      setFailed(state.status === 'error' || state.status === 'forbidden');
    });
    const visibility = () => {
      if (document.visibilityState === 'hidden') controller.suspend();
      else void controller.refresh();
    };
    document.addEventListener('visibilitychange', visibility);
    void controller.refresh();
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      stop();
      controller.suspend();
      host.current = null;
    };
  }, []);
  const refresh = () => {void host.current?.refresh();};
  return <main className={styles.main} data-lifeos-surface="personal">
    <a href="/personal?page=tasks">返回待办</a>
    <h1>待办分类预览</h1>
    <p>在这里拟定项目和标签。预览仅在当前页面显示。</p>
    {draftEpoch > 0 && entries && <p role="status">已重新核对范围，旧预览建议已清除。</p>}
    <Preview key={draftEpoch} entries={entries} failed={failed} onRefresh={refresh}/>
  </main>;
}

function Preview({entries, failed, onRefresh}: {
  entries: readonly PublicEntry[] | null; failed: boolean; onRefresh: () => void;
}) {
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(0);
  const {todos, projects, topics, lookup} = useMemo(() => {
    const snapshot = entries ?? noEntries;
    const lookup = new Map(snapshot.map(entry => [entry.id, entry]));
    const hasType = (entry: PublicEntry, type: 'project' | 'topic') =>
      'text' in entry.draft && entry.draft.personal?.type === type;
    const todos = snapshot.filter(entry => entry.kind === 'todo')
      .map(entry => ({id: entry.id, fields: validateTodo(entry.draft)}));
    return {lookup, todos, projects: snapshot.filter(entry => hasType(entry, 'project')),
      topics: snapshot.filter(entry => hasType(entry, 'topic'))};
  }, [entries]);
  if (!entries) return <>
    <p role="status">{failed ? '无法核对完整待办快照。' : '正在读取完整待办快照。'}</p>
    {failed && <Button variant="outline" onClick={onRefresh}>重新读取</Button>}
  </>;
  const title = (id: string) => {
    const draft = lookup.get(id)?.draft;
    return draft && 'title' in draft ? draft.title : '关联不可用';
  };
  const referenceTitle = (ref: PersonalReference) =>
    lookup.get(ref.id)?.source.id === ref.sourceId ? title(ref.id) : '关联不可用';
  const first = new Map<string, string>();
  const rows = todos.map(({id, fields}) => {
    const before = fields.personal;
    const proposal = proposals[id] ?? {project: before?.project?.id ?? '', topics: before?.topics.map(ref => ref.id) ?? []};
    const included = !excluded[id];
    const fingerprint = JSON.stringify([fields, proposal.project, proposal.topics]);
    const duplicate = included && first.get(fingerprint);
    if (included && !duplicate) first.set(fingerprint, id);
    return {id, fields, before, proposal, included, duplicate};
  });
  const count = Math.ceil(rows.length / pageSize);
  const update = (id: string, proposal: Proposal) => setProposals(values => ({...values, [id]: proposal}));
  return <>
    <div className={styles.controls}>
      <p role="status">共 {rows.length} 条 · 纳入 {rows.filter(row => row.included).length} 条</p>
      <Button variant="outline" onClick={onRefresh}>重新读取</Button>
    </div>
    {rows.length === 0 && <p>暂无待办。</p>}
    <div className={styles.rows}>
      {rows.slice(page * pageSize, (page + 1) * pageSize).map(({id, fields, before, proposal, included, duplicate}) =>
        <article className={styles.row} key={id}>
          <h2>{fields.title}</h2>
          {fields.notes && <p className={styles.notes}>{fields.notes}</p>}
          <p>原项目 {before?.project ? referenceTitle(before.project) : '未归组'} · 原标签 {before?.topics.map(referenceTitle).join('、') || '无'}</p>
          <p>建议项目 {proposal.project ? (before?.project?.id === proposal.project ? referenceTitle(before.project) : title(proposal.project)) : '未归组'} · 建议标签 {proposal.topics.map(id => {const prior = before?.topics.find(ref => ref.id === id); return prior ? referenceTitle(prior) : title(id);}).join('、') || '无'}</p>
          <p>{!included ? '已排除' : duplicate ? '完整字段与建议分类相同，建议人工核对重复。' : '单独保留。'}</p>
          <label><input type="checkbox" checked={included} onChange={event => setExcluded(values => ({...values, [id]: !event.target.checked}))}/> 纳入预览</label>
          <details>
            <summary>调整建议</summary>
            <label>建议项目 <select value={proposal.project} onChange={event => update(id, {...proposal, project: event.target.value})}>
              <option value="">未归组</option>
              {proposal.project && !projects.some(project => project.id === proposal.project) &&
                <option value={proposal.project}>关联不可用</option>}
              {projects.map(project => <option key={project.id} value={project.id}>{title(project.id)}</option>)}
            </select></label>
            {topics.length > 0 && <fieldset><legend>建议标签</legend>
              {topics.map(topic => <label key={topic.id}><input type="checkbox" checked={proposal.topics.includes(topic.id)}
                onChange={event => update(id, {...proposal, topics: event.target.checked
                  ? [...proposal.topics, topic.id] : proposal.topics.filter(value => value !== topic.id)})}/> {title(topic.id)}</label>)}
            </fieldset>}
          </details>
        </article>)}
    </div>
    {count > 1 && <nav className={styles.controls} aria-label="预览分页">
      <Button variant="outline" onClick={() => setPage(page - 1)} disabled={page === 0}>上一页</Button>
      <p>第 {page + 1} / {count} 页</p>
      <Button variant="outline" onClick={() => setPage(page + 1)} disabled={page + 1 >= count}>下一页</Button>
    </nav>}
  </>;
}
