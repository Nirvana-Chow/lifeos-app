'use client';

import {useEffect, useRef, useState} from 'react';
import {useOwnerPageVerification} from '../personal-candidate/privacy';
import {projectDetailHref} from '../personal-candidate/project-detail-href';
import {fileIndexPath, indexResponseSchema, openResponseSchema, samePin, type FileIndex, type FileIndexRow} from './contract';
import styles from './panel.module.css';

type View = 'loading' | 'denied' | 'error' | FileIndex;

export function FileIndexPanel({initialId}: {initialId?: string}) {
  const verified = useOwnerPageVerification();
  const [view, setView] = useState<View>('loading');
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState('');
  const action = useRef<AbortController | null>(null);
  const normalizedId = initialId?.toLowerCase();

  useEffect(() => {
    setView('loading');
    setOpening(false);
    setNotice('');
    if (verified !== true) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await read(fileIndexPath, controller.signal);
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          setView('denied');
          return;
        }
        if (!response.ok) throw Error();
        const value = indexResponseSchema.parse(await response.json());
        if (!controller.signal.aborted) setView(value);
      } catch {
        if (!controller.signal.aborted) setView('error');
      }
    }
    void load();
    return () => {
      controller.abort();
      action.current?.abort();
      action.current = null;
    };
  }, [verified, reload]);

  async function openProject(row: FileIndexRow) {
    if (verified !== true || action.current || row.project.state !== 'current' || row.location.state === 'example') return;
    const expected = row.project.pin;
    const controller = new AbortController();
    action.current = controller;
    setOpening(true);
    setNotice('');
    try {
      const response = await read(fileIndexPath + '/' + row.id + '/project', controller.signal);
      if (controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) {
        setView('denied');
        return;
      }
      if (response.status === 404 || response.status === 409) {
        setNotice('项目关联已变化或不可访问，请重新读取索引。');
        return;
      }
      if (!response.ok) throw Error();
      const value = openResponseSchema.parse(await response.json());
      if (controller.signal.aborted || document.visibilityState === 'hidden') return;
      if (!samePin(value.file, row) || !samePin(value.project, expected)) {
        setNotice('索引或项目关联已变化，请重新读取索引。');
        return;
      }
      window.location.assign(projectDetailHref(value.project.id));
    } catch {
      if (!controller.signal.aborted) setNotice('暂时无法核对项目，请重试。');
    } finally {
      if (action.current === controller) {
        action.current = null;
        setOpening(false);
      }
    }
  }

  if (view === 'loading' || verified !== true) return <p className={styles.panel} role="status">正在读取文件索引…</p>;
  if (view === 'denied') return <section className={styles.panel} role="status">当前会话无权查看文件索引。 <a href="/login">重新登录</a></section>;
  if (view === 'error') return <section className={styles.panel} role="alert">文件索引读取失败。 <button type="button" onClick={() => setReload(value => value + 1)}>重新读取</button></section>;
  if (view.state === 'unconnected') return <p className={styles.panel} role="status">文件索引尚未接入授权的元数据来源。</p>;
  if (view.rows.length === 0) return <p className={styles.panel} role="status">当前来源没有文件索引记录。</p>;

  const needle = query.trim().toLowerCase();
  const rows = view.rows.filter(row => (!normalizedId || row.id === normalizedId) &&
    (!needle || [row.title, row.id, row.location.label].some(value => value?.toLowerCase().includes(needle))));
  return <section className={styles.panel} aria-label="文件索引">
    <div className={styles.controls}>
      <label>搜索文件索引 <input type="search" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <button type="button" disabled={opening} onClick={() => setReload(value => value + 1)}>重新读取</button>
      {normalizedId && <a href="/personal/files">查看全部索引</a>}
    </div>
    {notice && <p role="alert">{notice}</p>}
    {!rows.length ? <p role="status">没有找到对应的文件索引。</p> : <ul className={styles.rows}>
      {rows.map(row => <li key={row.id}>
        <h2><a href={'/personal/files?id=' + row.id}>{row.title}</a></h2>
        <p>{locationText(row.location.state)}{row.location.label ? ' · ' + row.location.label : ''}</p>
        {row.location.state === 'verified' && <p>来源核验时间 <time dateTime={row.location.verifiedAt}>{row.location.verifiedAt.slice(0, 10)}</time></p>}
        {row.project.state === 'current' && row.location.state !== 'example'
          ? <button type="button" disabled={opening} onClick={() => void openProject(row)}>打开项目：{row.project.title}</button>
          : <p>{row.location.state === 'example' ? '示例不可打开' : projectText(row.project.state)}</p>}
      </li>)}
    </ul>}
  </section>;
}

function read(path: string, signal: AbortSignal) {
  return fetch(path, {cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal});
}

function locationText(state: FileIndexRow['location']['state']) {
  return state === 'verified' ? '位置经来源核验' : state === 'example' ? '示例位置' : '位置待核';
}

function projectText(state: FileIndexRow['project']['state']) {
  if (state === 'changed') return '关联项目已升版或修订不一致，待核';
  return state === 'unlinked' ? '未关联项目' : '关联项目不可用';
}
