'use client';

import {useEffect, useRef, useState, type FormEvent} from 'react';
import {flushSync} from 'react-dom';
import {Badge} from '../ui-review/ui/badge';
import {Button} from '../ui-review/ui/button';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '../ui-review/ui/dialog';
import {Input} from '../ui-review/ui/input';
import {resolveApiKeyExpiry} from './account-api-key-expiry';
import styles from './account-api-keys.module.css';

const endpoint = '/api/platform/account/api-keys';
const statuses = {active: '有效', expired: '已到期', revoked: '已撤销'};
type Grant = {
  id: string;
  name: string;
  scopes: ('todo:read' | 'todo:write')[];
  createdAt: string;
  expiresAt: string | null;
  status: keyof typeof statuses;
};
type List = {kind: 'loading' | 'disabled' | 'denied' | 'error'} | {kind: 'ready'; grants: Grant[]; nextCursor?: string};
const requestOptions = {cache: 'no-store', credentials: 'same-origin'} as const;
async function readGrantPage(response: Response) {
  const data: {keys: Grant[]; nextCursor?: string} = await response.json();
  if (!Array.isArray(data.keys) ||
      (data.nextCursor !== undefined && (typeof data.nextCursor !== 'string' || !data.nextCursor))) throw Error();
  return {grants: data.keys, nextCursor: data.nextCursor};
}

const formatDate = (value: string) => new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));

export function AccountApiKeys() {
  const [list, setList] = useState<List>({kind: 'loading'});
  const [loadVersion, setLoadVersion] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState(false);
  const [name, setName] = useState('');
  const [permission, setPermission] = useState('read');
  const [expiry, setExpiry] = useState('30');
  const [replacement, setReplacement] = useState<Grant | null>(null);
  const [revoking, setRevoking] = useState<Grant | null>(null);
  const [reveal, setReveal] = useState<{key: string; grant: Grant} | null>(null);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const revealHeading = useRef<HTMLHeadingElement>(null);
  const revoker = useRef<HTMLButtonElement | null>(null);
  const pageActive = useRef(true);
  const actionLock = useRef(false);
  const moreRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(endpoint, {...requestOptions, signal: controller.signal});
        if (controller.signal.aborted) return;
        if (response.status === 404) return setList({kind: 'disabled'});
        if (response.status === 401 || response.status === 403) return setList({kind: 'denied'});
        if (!response.ok) return setList({kind: 'error'});
        const page = await readGrantPage(response);
        if (!controller.signal.aborted) setList({kind: 'ready', ...page});
      } catch {
        if (!controller.signal.aborted) setList({kind: 'error'});
      }
    }
    void load();
    return () => {controller.abort(); moreRequest.current?.abort();};
  }, [loadVersion]);

  useEffect(() => {
    function hide() {
      pageActive.current = false;
      flushSync(() => {setReveal(null); setCopied(false);});
    }
    function show() {pageActive.current = true;}
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    return () => {
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
    };
  }, []);

  useEffect(() => {
    if (reveal) revealHeading.current?.focus();
  }, [reveal]);

  function reload() {
    moreRequest.current?.abort();
    moreRequest.current = null;
    setLoadingMore(false);
    setPageError(false);
    setList({kind: 'loading'});
    setLoadVersion(version => version + 1);
  }

  async function loadMore() {
    if (list.kind !== 'ready' || !list.nextCursor || moreRequest.current) return;
    const cursor = list.nextCursor;
    const controller = new AbortController();
    moreRequest.current = controller;
    setLoadingMore(true);
    setPageError(false);
    try {
      const response = await fetch(endpoint + '?cursor=' + encodeURIComponent(cursor),
        {...requestOptions, signal: controller.signal});
      if (!response.ok) throw Error();
      const page = await readGrantPage(response);
      if (page.nextCursor === cursor) throw Error();
      if (controller.signal.aborted) return;
      setList(current => {
        if (current.kind !== 'ready' || current.nextCursor !== cursor) return current;
        const grants = new Map(current.grants.map(grant => [grant.id, grant]));
        for (const grant of page.grants) grants.set(grant.id, grant);
        return {kind: 'ready', grants: [...grants.values()], nextCursor: page.nextCursor};
      });
    } catch {
      if (!controller.signal.aborted) setPageError(true);
    } finally {
      if (moreRequest.current === controller) {
        moreRequest.current = null;
        setLoadingMore(false);
      }
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionLock.current || reveal || list.kind !== 'ready') return;
    const data = new FormData(event.currentTarget);
    const expiration = resolveApiKeyExpiry(expiry, String(data.get('custom-expiry') ?? ''));
    if (!name.trim() || !expiration) {
      setMessage('请填写名称，并选择未来 365 天内的有效到期时间。');
      return;
    }
    actionLock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const scopes = permission === 'write' ? ['todo:read', 'todo:write'] : ['todo:read'];
      const response = await fetch(endpoint, {
        ...requestOptions,
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: name.trim(), scopes, ...expiration}),
      });
      if (response.status === 400) {
        setMessage('创建请求未通过。请核对名称、权限和到期时间。');
        return;
      }
      if (!response.ok) throw Error();
      const result: {key: string; grant: Grant} = await response.json();
      if (typeof result.key !== 'string' || !result.key || !result.grant?.id) throw Error();
      if (pageActive.current) setReveal(result);
      setCopied(false);
      setName('');
      setReplacement(null);
      reload();
    } catch {
      setMessage('创建结果未确认。请先检查密钥列表，再决定是否重新创建。');
      reload();
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }

  async function revoke() {
    if (actionLock.current || !revoking) return;
    actionLock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(endpoint + '/' + encodeURIComponent(revoking.id), {
        ...requestOptions, method: 'DELETE',
      });
      if (response.status !== 204) throw Error();
      if (replacement?.id === revoking.id) setReplacement(null);
      if (reveal?.grant.id === revoking.id) setReveal(null);
      setMessage('密钥已撤销。');
    } catch {
      setMessage('撤销结果未确认。请检查列表中的密钥状态。');
    } finally {
      actionLock.current = false;
      setBusy(false);
      setRevoking(null);
      reload();
    }
  }

  async function copy() {
    if (!reveal) return;
    try {
      await navigator.clipboard.writeText(reveal.key);
      setCopied(true);
    } catch {
      setMessage('无法访问剪贴板，请手动选中密钥并复制。');
    }
  }

  function prepareReplacement(grant: Grant) {
    setReplacement(grant);
    setName(grant.name);
    setPermission(grant.scopes.includes('todo:write') ? 'write' : 'read');
    setExpiry('30');
    nameInput.current?.focus();
  }

  return <main data-lifeos-surface="auth"><div className={styles.page}>
    <nav className={styles.nav} aria-label="账户设置">
      <a href="/personal?page=settings">返回设置</a>
      <a href="/account/password">修改密码</a>
    </nav>
    <header>
      <h1>API 密钥</h1>
      <p>为 LifeOS Skill 授予待办权限。每把密钥都有到期时间，也可以单独撤销。</p>
    </header>
    {message && <p role="status">{message}</p>}
    {reveal && <section className={styles.reveal} aria-labelledby="key-reveal-title">
      <h2 id="key-reveal-title" ref={revealHeading} tabIndex={-1}>复制新密钥</h2>
      <p>完整密钥只显示这一次。请保存到密码管理器，并在 Skill 中配置。</p>
      <code aria-label="新密钥" className={styles.secret}>{reveal.key}</code>
      <div className={styles.actions}>
        <Button type="button" onClick={copy}>复制密钥</Button>
        <Button type="button" variant="outline" onClick={() => {setReveal(null); setCopied(false);}}>关闭密钥</Button>
        {copied && <span role="status">已复制</span>}
      </div>
    </section>}
    {list.kind === 'loading' && <p role="status">正在读取密钥…</p>}
    {list.kind === 'disabled' && <p role="status">当前站点尚未启用 API 密钥管理。</p>}
    {list.kind === 'denied' && <p>请<a href="/login">重新登录</a>并完成两步验证。</p>}
    {list.kind === 'error' && <p>暂时无法读取密钥。 <Button type="button" variant="outline" onClick={reload}>重新读取</Button></p>}
    {list.kind === 'ready' && <>
      <section className={styles.section} aria-labelledby="key-create-title">
        <h2 id="key-create-title">{replacement ? '创建替换密钥' : '新建密钥'}</h2>
        {replacement && <p>正在为「{replacement.name}」创建新密钥。先在 Skill 中验证新密钥，再撤销原密钥。</p>}
        <form method="post" action="/account/api-keys" onSubmit={create}>
          <fieldset className={styles.fields} disabled={busy || !!reveal}>
            <label>名称<Input ref={nameInput} name="name" required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="例如：个人待办 Skill"/></label>
            <label>权限<select name="permission" value={permission} onChange={event => setPermission(event.target.value)}>
              <option value="read">仅读取待办</option><option value="write">读取和写入待办</option>
            </select></label>
            <label>到期时间<select name="expiry" value={expiry} onChange={event => setExpiry(event.target.value)}>
              <option value="7">7 天后</option><option value="30">30 天后</option><option value="90">90 天后</option><option value="365">365 天后（一年）</option><option value="custom">自定义</option>
            </select></label>
            {expiry === 'custom' && <label className={styles.custom}>自定义到期时间
              <Input type="datetime-local" name="custom-expiry" aria-describedby="key-timezone" required/>
              <small id="key-timezone">时区 {Intl.DateTimeFormat().resolvedOptions().timeZone}，最长 365 天。</small>
            </label>}
            <div className={styles.actions}>
              <Button type="submit">{busy ? '正在处理…' : '创建密钥'}</Button>
              {replacement && <Button type="button" variant="outline" onClick={() => {setReplacement(null); setName('');}}>取消替换</Button>}
            </div>
          </fieldset>
        </form>
      </section>
      <section className={styles.section} aria-labelledby="key-list-title">
        <h2 id="key-list-title">已签发的密钥</h2>
        {list.grants.length === 0 ? <p>还没有签发密钥。</p> : <ul className={styles.list}>
          {list.grants.map(grant => <li key={grant.id} className={styles.grant}>
            <div>
              <div className={styles.grantHeading}><strong>{grant.name}</strong><Badge variant={grant.status === 'active' ? 'default' : 'secondary'}>{statuses[grant.status]}</Badge></div>
              <p>{grant.scopes.includes('todo:write') ? '读取和写入待办' : '仅读取待办'}</p>
              <dl className={styles.details}>
                <div><dt>授权编号</dt><dd><code>{grant.id}</code></dd></div>
                <div><dt>创建</dt><dd><time dateTime={grant.createdAt}>{formatDate(grant.createdAt)}</time></dd></div>
                <div><dt>到期</dt><dd>{grant.expiresAt ? <time dateTime={grant.expiresAt}>{formatDate(grant.expiresAt)}</time> : '未设置'}</dd></div>
              </dl>
            </div>
            {grant.status === 'active' && <div className={styles.actions}>
              <Button type="button" variant="outline" disabled={busy || !!reveal} aria-label={'替换 ' + grant.name} onClick={() => prepareReplacement(grant)}>替换</Button>
              <Button type="button" variant="ghost" disabled={busy || !!reveal} aria-label={'撤销 ' + grant.name} onClick={event => {revoker.current = event.currentTarget; setRevoking(grant);}}>撤销</Button>
            </div>}
          </li>)}
        </ul>}
        {pageError && <p role="status">暂时无法读取更多密钥，请重试。</p>}
        {list.nextCursor && <Button type="button" variant="outline" disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? '正在读取…' : '加载更多密钥'}
        </Button>}
      </section>
    </>}
    <Dialog open={!!revoking} onOpenChange={open => {if (!open && !actionLock.current) setRevoking(null);}}>
      <DialogContent showCloseButton={false} onCloseAutoFocus={event => {
        event.preventDefault();
        if (revoker.current?.isConnected) revoker.current.focus();
      }}>
        <DialogTitle>撤销密钥</DialogTitle>
        <DialogDescription>撤销「{revoking?.name}」后，使用这把密钥的 Skill 将无法继续访问待办。</DialogDescription>
        <div className={styles.actions}>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setRevoking(null)}>取消</Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={revoke}>{busy ? '正在撤销…' : '确认撤销'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </div></main>;
}
