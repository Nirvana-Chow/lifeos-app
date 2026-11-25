'use client';

import {useEffect, useMemo, useRef, useState} from 'react';
import {Button} from '../ui-review/ui/button';
import type {PublicEntry} from '../platform/contracts';
import {validateTodo} from '../platform/domain';
import {PersonalWorkspaceController} from './workspace-controller';
import type {PersonalReference} from './business';
import {personalReferences} from './business';
import styles from './task-classification-preview.module.css';

type Proposal = {project: string; topics: string[]};
const pageSize = 20;
const noEntries: readonly PublicEntry[] = [];

function snapshotIdentity(controller: PersonalWorkspaceController) {
  const entries = controller.getClassificationEntries();
  const binding = controller.getEditorBinding();
  return entries && binding ? JSON.stringify([binding.ownerId, binding.spaceId,
    entries.map(entry => [entry.id, entry.source.id, entry.revision]).sort((a, b) =>
      String(a[0]).localeCompare(String(b[0])))]) : null;
}

function downloadPreview(value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'lifeos-todo-classification-preview.json';
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

export function TaskClassificationPreview({embedded = false}: {embedded?: boolean} = {}) {
  const host = useRef<PersonalWorkspaceController | null>(null);
  const [entries, setEntries] = useState<readonly PublicEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draftEpoch, setDraftEpoch] = useState(0);
  const [result, setResult] = useState('');
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
      const identity = snapshotIdentity(controller);
      if (identity !== null) {
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
  const verifyBeforeSave = async () => {
    const controller = host.current;
    const before = controller && snapshotIdentity(controller);
    if (!controller || !before) return false;
    await controller.refresh();
    return host.current === controller && document.visibilityState === 'visible' &&
      snapshotIdentity(controller) === before;
  };
  const content = <>
    <p>在这里拟定项目和标签。下载副本会包含原条目及其处理结果，待办记录不受影响。</p>
    {draftEpoch > 0 && entries && <p role="status">已重新核对范围，旧预览建议已清除。</p>}
    {result && <p role="status">{result}</p>}
    <Preview key={draftEpoch} entries={entries} failed={failed} onRefresh={refresh} verifyBeforeSave={verifyBeforeSave} report={setResult}/>
  </>;
  return embedded ? content : <main className={styles.main} data-lifeos-surface="personal">
    <a href="/personal?page=tasks">返回待办</a>
    <h1>待办分类预览</h1>
    {content}
  </main>;
}

function hasType(entry: PublicEntry, type: string) {
  return 'text' in entry.draft && entry.draft.personal?.type === type;
}

function Preview({entries, failed, onRefresh, verifyBeforeSave, report}: {
  entries: readonly PublicEntry[] | null; failed: boolean; onRefresh: () => void;
  verifyBeforeSave: () => Promise<boolean>; report: (message: string) => void;
}) {
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const {todos, projects, topics, lookup} = useMemo(() => {
    const snapshot = entries ?? noEntries;
    const lookup = new Map(snapshot.map(entry => [entry.id, entry]));

    const todos = snapshot.filter(entry => entry.kind === 'todo')
      .map(entry => ({entry, fields: validateTodo(entry.draft)}));
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
  const rows = todos.map(({entry, fields}) => {
    const id = entry.id;
    const before = fields.personal;
    const proposal = proposals[id] ?? {project: before?.project?.id ?? '', topics: before?.topics.map(ref => ref.id) ?? []};
    const protectedReason = fields.status === 'done' || fields.status === 'cancelled'
      ? '保留已结束的待办'
      : personalReferences(fields).some(({link, type}) => {
        const target = lookup.get(link.id);
        return !target || !hasType(target, type) || target.source.id !== link.sourceId || target.revision !== link.revision;
      }) ? '原分类关联已经变化或无法核对' : null;
    const included = !protectedReason && !excluded[id];
    const fingerprint = JSON.stringify([fields, proposal.project, proposal.topics]);
    const duplicate = included && first.get(fingerprint);
    if (included && !duplicate) first.set(fingerprint, id);
    const proposedProject = proposal.project === before?.project?.id && before.project
      ? referenceTitle(before.project) : proposal.project ? title(proposal.project) : '未归组';
    const proposedTopics = proposal.topics.map(id => {
      const prior = before?.topics.find(ref => ref.id === id);
      return prior ? referenceTitle(prior) : title(id);
    });
    return {id, entry, fields, before, proposal, included, duplicate, protectedReason, proposedProject, proposedTopics};
  });
  const count = Math.ceil(rows.length / pageSize);
  const update = (id: string, proposal: Proposal) => {
    report('');
    setProposals(values => ({...values, [id]: proposal}));
  };
  const cancel = () => {
    setProposals({});
    setExcluded({});
    report('已取消本次调整。待办记录未修改。');
  };
  async function save() {
    setSaving(true);
    report('');
    try {
      if (!await verifyBeforeSave()) {
        report('未保存预览。请重新核对完整快照后再试。');
        return;
      }
      const records = rows.map(({id, entry, fields, proposal, included, duplicate, protectedReason}) => ({
        original: {id, sourceId: entry.source.id, revision: entry.revision, fields},
        suggestion: included ? {
          project: proposal.project ? exportReference(proposal.project) : null, topics: proposal.topics.map(exportReference),
        } : null,
        disposition: protectedReason ? 'protected' : !included ? 'excluded' : duplicate ? 'duplicate-candidate' : 'retain',
        protectedReason, duplicateOf: duplicate || null,
      }));
      downloadPreview({format: 'lifeos.todo-classification.review-copy.v1', records});
      report('已生成预览副本，请查看浏览器下载记录。待办记录未修改。');
    } catch {
      report('未能生成预览副本。');
    } finally {
      setSaving(false);
    }
  }
  function exportReference(id: string) {
    const target = lookup.get(id);
    if (!target) throw Error('Missing verified classification reference');
    return {id, sourceId: target.source.id, revision: target.revision, title: title(id)};
  }
  return <>
    <div className={styles.controls}>
      <p role="status">共 {rows.length} 条 · 纳入 {rows.filter(row => row.included).length} 条</p>
      <Button variant="outline" onClick={onRefresh}>重新读取</Button>
      <Button variant="outline" onClick={cancel} disabled={saving}>取消本次调整</Button>
      <Button onClick={() => void save()} disabled={saving || !rows.length}>保存预览副本</Button>
    </div>
    {rows.length === 0 && <p>暂无待办。</p>}
    <div className={styles.rows}>
      {rows.slice(page * pageSize, (page + 1) * pageSize).map(({id, fields, before, proposal, included, duplicate, protectedReason, proposedProject, proposedTopics}) =>
        <article className={styles.row} key={id}>
          <h2>{fields.title}</h2>
          {fields.notes && <p className={styles.notes}>{fields.notes}</p>}
          <p>原项目 {before?.project ? referenceTitle(before.project) : '未归组'} · 原标签 {before?.topics.map(referenceTitle).join('、') || '无'}</p>
          <p>{protectedReason ? '建议保持原分类。' :
            <>建议项目 {proposedProject} · 建议标签 {proposedTopics.join('、') || '无'}</>}</p>
          <p>{protectedReason ? '受保护 · ' + protectedReason : !included ? '已排除' : duplicate ? '完整字段与建议分类相同，建议人工核对重复。' : '单独保留。'}</p>
          {!protectedReason && <>
          <label><input type="checkbox" checked={included} onChange={event => {
            report('');
            setExcluded(values => ({...values, [id]: !event.target.checked}));
          }}/> 纳入预览</label>
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
          </>}
        </article>)}
    </div>
    {count > 1 && <nav className={styles.controls} aria-label="预览分页">
      <Button variant="outline" onClick={() => setPage(page - 1)} disabled={page === 0}>上一页</Button>
      <p>第 {page + 1} / {count} 页</p>
      <Button variant="outline" onClick={() => setPage(page + 1)} disabled={page + 1 >= count}>下一页</Button>
    </nav>}
  </>;
}
