'use client';

import {createContext,useContext,useLayoutEffect,useRef,type RefObject} from 'react';
import {Button} from '../ui-review/ui/button';
import {Input} from '../ui-review/ui/input';
import {mountStorageReview} from './browser-runtime.mjs';
import './workspace-body.css';

export type StorageReviewHost = {activeContentGuard:RefObject<(() => boolean)|null>};
export const StorageReviewHostContext = createContext<StorageReviewHost|null>(null);

export function StorageReviewBody() {
  const root = useRef<HTMLDivElement>(null);
  const host = useContext(StorageReviewHostContext);
  useLayoutEffect(() => {
    if (!root.current) return;
    const instance = mountStorageReview(root.current,true);
    if (host) host.activeContentGuard.current = instance.mayLeave;
    return () => {
      if (host?.activeContentGuard.current === instance.mayLeave) host.activeContentGuard.current = null;
      instance.dispose();
    };
  },[host?.activeContentGuard]);

  return <div ref={root} className="storage-review-body" data-storage-review-body>
    <section id="storage-verification">
      <p id="storage-verification-message" role="status">正在核对本人空间…</p>
      <div className="actions">
        <Button id="storage-verify" type="button" variant="outline">重新核对</Button>
        <a href="/login" id="storage-relogin" hidden>重新登录</a>
      </div>
    </section>
    <section id="storage-review-body" hidden inert>
      <div className="review-summary">
        <div><p>审核选项只记录决定。选择删除候选不会删除文件。</p><p id="summary" hidden/></div>
        <section aria-label="审核进度"><strong id="progress-text">0 / 0</strong>
          <progress id="progress" value={0} max={1} aria-label="已记录决定的进度"/>
        </section>
      </div>
      <div className="controls" aria-label="清单工具">
        <label className="search" htmlFor="search">搜索资料<Input id="search" type="search" placeholder="编号、名称或关键词" autoComplete="off"/></label>
        <label htmlFor="filter">筛选<select id="filter">
          <option value="all">全部资料</option><option value="pending">尚未决定</option><option value="selected">已选决定</option>
          <option value="keep">留</option><option value="trash">删除候选</option><option value="defer">暂缓</option><option value="processed">已处理／受保护</option>
        </select></label>
        <label htmlFor="group-filter">分组<select id="group-filter"><option value="">全部分组</option></select></label>
      </div>
      <div className="actions">
        <Button type="button" id="compact" variant="outline" aria-pressed={false}>精简视图</Button>
        <Button type="button" id="import" variant="outline">导入清单</Button>
        <Button type="button" id="copy" variant="outline" disabled>复制编号</Button>
        <Button type="button" id="export" disabled>导出决定</Button>
        <input type="file" id="file" accept=".csv,.json,text/csv,application/json" hidden/>
      </div>
      <div className="meta"><span id="sync-state">本机预览</span><div className="actions">
        <a href="/login" id="sync-login" hidden>重新登录</a>
        <Button type="button" id="open-server" variant="outline">打开 LifeOS 清单</Button>
        <Button type="button" id="save-server" variant="outline" disabled>保存清单到 LifeOS</Button>
      </div></div>
      <div className="meta"><span id="visible"/><span id="counts"/></div>
      <p id="notice" role="status"/>
      <p id="note-draft-state" role="status"/>
      <section id="pending-input" className="pending-input" hidden aria-labelledby="pending-title">
        <strong id="pending-title">待确认的选择</strong><p id="pending-description"/>
        <div className="actions">
          <Button type="button" id="retry-decision" variant="outline">确认后重试保存</Button>
          <Button type="button" id="discard-decision" variant="ghost">放弃本次输入</Button>
        </div>
      </section>
      <div id="list"/>
      <footer id="revision"/>
    </section>
    <dialog id="copy-dialog" aria-labelledby="copy-title">
      <h2 id="copy-title">复制审核决定</h2><label htmlFor="copy-text">选中并复制以下编号</label>
      <textarea id="copy-text" readOnly/><Button id="close-copy" type="button" variant="outline">关闭</Button>
    </dialog>
  </div>;
}
