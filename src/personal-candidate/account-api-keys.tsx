'use client';

import {useEffect, useRef, useState, type FormEvent} from 'react';
import {flushSync} from 'react-dom';
import {Badge} from '../ui-review/ui/badge';
import {Button} from '../ui-review/ui/button';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '../ui-review/ui/dialog';
import {Input} from '../ui-review/ui/input';
import {agentScopes, normalizeAgentScopes, type AgentScope} from '../agent-api/scopes';
import {estimateApiKeyExpiry, resolveApiKeyExpiry} from './account-api-key-expiry';
import styles from './account-api-keys.module.css';

const endpoint = '/api/platform/account/api-keys';
const statuses = {active: '有效', expired: '已到期', revoked: '已撤销'};
type Grant = {
  id: string;
  name: string;
  scopes: readonly AgentScope[];
  grantDigest?: string;
  createdAt: string;
  expiresAt: string | null;
  status: keyof typeof statuses;
};
type List = {kind: 'loading' | 'disabled' | 'denied' | 'error'} | {kind: 'ready'; grants: Grant[]; nextCursor?: string; availableScopes?: readonly AgentScope[]};
const requestOptions = {cache: 'no-store', credentials: 'same-origin'} as const;
async function readGrantPage(response: Response) {
  const data: {keys: Grant[]; nextCursor?: string; availableScopes?: readonly AgentScope[]} = await response.json();
  if (!Array.isArray(data.keys) ||
      (data.nextCursor !== undefined && (typeof data.nextCursor !== 'string' || !data.nextCursor))) throw Error();
  return {grants: data.keys, nextCursor: data.nextCursor, availableScopes: data.availableScopes === undefined ? undefined : normalizeAgentScopes(data.availableScopes)};
}

const scopeModules = [{id: 'todo', label: '待办'}, {id: 'organization', label: '项目、领域和主题'}] as const;
const describeScopes = (scopes: readonly AgentScope[]) => scopeModules.filter(module => scopes.includes(`${module.id}:read`))
  .map(module => `${module.label}：${scopes.includes(`${module.id}:write`) ? '读取和写入' : '仅读取'}`).join('；') || '未选择权限';
const sameScopes = (a: readonly AgentScope[], b: readonly AgentScope[]) => a.length === b.length && a.every(scope => b.includes(scope));
type ScopeEdit = {current: Grant; proposed: readonly AgentScope[]; phase: 'editing' | 'saving' | 'conflict' | 'unknown';
  frozen?: Readonly<{expectedGrantDigest: string; scopes: readonly AgentScope[]}>};

function ScopeFields({available, value, onChange, disabled=false}: {available: readonly AgentScope[]; value: readonly AgentScope[];
  onChange: (value: readonly AgentScope[]) => void; disabled?: boolean}) {
  function change(scope: AgentScope, checked: boolean) {
    const next = new Set(value);
    const [module, action] = scope.split(':') as ['todo' | 'organization', 'read' | 'write'];
    if (checked) {next.add(scope); if (action === 'write') next.add(`${module}:read`);}
    else {next.delete(scope); if (action === 'read') next.delete(`${module}:write`);}
    onChange(agentScopes.filter(item => next.has(item)));
  }
  return <fieldset className={styles.scopeFields} disabled={disabled}><legend>权限</legend>
    {scopeModules.filter(module => available.includes(`${module.id}:read`)).map(module => <div key={module.id}>
      <strong>{module.label}</strong>
      {(['read','write'] as const).map(action => {
        const scope = `${module.id}:${action}` as AgentScope;
        return available.includes(scope) ? <label key={action}><input type="checkbox" checked={value.includes(scope)}
          onChange={event => change(scope,event.target.checked)}/>{action === 'read' ? '读取' : '写入'}{module.label}</label> : null;
      })}
    </div>)}
  </fieldset>;
}

const formatDate = (value: string) => new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium', timeStyle: 'short',
}).format(new Date(value));

export function AccountApiKeys({embedded=false, closeGuard}: {embedded?:boolean; closeGuard?:{current:(()=>boolean)|null}}) {
  const [list, setList] = useState<List>({kind: 'loading'});
  const [loadVersion, setLoadVersion] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pageError, setPageError] = useState(false);
  const [name, setName] = useState('');
  const [permission, setPermission] = useState('read');
  const [createScopes, setCreateScopes] = useState<readonly AgentScope[]>(['todo:read']);
  const [scopeEdit, setScopeEdit] = useState<ScopeEdit | null>(null);
  const scopeEditRef = useRef<ScopeEdit | null>(null);
  const scopeTrigger = useRef<HTMLButtonElement | null>(null);
  const [scopeMessage, setScopeMessage] = useState('');
  const [readingScopes, setReadingScopes] = useState(false);
  const scopeReadLock = useRef(false);
  function updateScopeEdit(value: ScopeEdit | null) {scopeEditRef.current = value; setScopeEdit(value);}
  const [expiry, setExpiry] = useState('30');
  const [estimatedExpiry, setEstimatedExpiry] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setEstimatedExpiry(estimateApiKeyExpiry(expiry));
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, [expiry]);
  const [replacement, setReplacement] = useState<Grant | null>(null);
  const [revoking, setRevoking] = useState<Grant | null>(null);
  const [reveal, setReveal] = useState<{key: string; grant: Grant} | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [copied, setCopied] = useState(false);
  const [skillMessage, setSkillMessage] = useState('');
  const [instructions, setInstructions] = useState('');
  const creator = useRef<HTMLButtonElement | null>(null);
  const creatorGrant = useRef<string | null>(null);
  const newKeyButton = useRef<HTMLButtonElement>(null);
  const replacementButtons = useRef(new Map<string,HTMLButtonElement>());
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
        if (!controller.signal.aborted) {
          setList({kind: 'ready', ...page});
          setUncertain(false);
        }
      } catch {
        if (!controller.signal.aborted) setList({kind: 'error'});
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    }
    void load();
    return () => {controller.abort(); moreRequest.current?.abort();};
  }, [loadVersion]);

  useEffect(() => {
    pageActive.current = true;
    function hide() {
      pageActive.current = false;
      flushSync(() => {setReveal(null); setCopied(false); setDialogOpen(false);});
    }
    function show() {pageActive.current = true;}
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    return () => {
      pageActive.current = false;
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
    };
  }, []);

  useEffect(() => {
    if (reveal) revealHeading.current?.focus();
  }, [reveal]);

  useEffect(() => {
    if (!closeGuard) return;
    // Radix's document Escape layer registration can lag autofocus. Keep the
    // settings host intact while either child dialog is present.
    closeGuard.current = () => !dialogOpen && !revoking && !scopeEditRef.current && !actionLock.current && !uncertain;
    return () => {closeGuard.current = null;};
  }, [closeGuard, dialogOpen, revoking, uncertain, scopeEdit]);

  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (actionLock.current || uncertain || scopeEditRef.current?.phase === 'unknown') {event.preventDefault(); event.returnValue = '';}
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [uncertain]);

  function closeDialog() {
    if (actionLock.current || uncertain) return;
    setDialogOpen(false);
    setReveal(null);
    setCopied(false);
    setMessage('');
    setReplacement(null);
    setName('');
  }

  function prepareCreate(trigger: HTMLButtonElement, grant: Grant | null = null) {
    creator.current = trigger;
    creatorGrant.current = grant?.id ?? null;
    setReplacement(grant);
    setName(grant?.name ?? '');
    setPermission(grant?.scopes.includes('todo:write') ? 'write' : 'read');
    setCreateScopes(grant?.scopes ?? ['todo:read']);
    setExpiry('30');
    setMessage('');
    setDialogOpen(true);
  }

  async function copyInstructions() {
    const text = `请从 ${window.location.origin}/api/platform/agent-skill 下载 LifeOS Agent Skill（lifeos-agent.tar.gz），解压后将完整 lifeos-agent 文件夹安装到当前 AI 工具支持的 Skills 目录，并保留 SKILL.md 与 references 的相对位置。如果工具不支持安装 Skill，请先让它读取 SKILL.md 和引用文件。\n\n在本站 API 密钥设置中新建自己的密钥，只授予需要的模块读取或写入权限。通过当前工具批准的凭据存储单独配置密钥与本站 HTTPS 地址；不要把密钥写入 Skill、聊天、URL 或共享文件。压缩包不包含任何人的密钥。\n\n开始使用时，让 AI 读取 Skill 及随包的 references/operations.md，先执行能力发现，再按实际授权读取记录。写入前明确目标，写入后读回确认。当前支持待办以及项目、领域和主题的查询、新建和修改；实际可用业务以能力发现和操作清单为准。`;
    setInstructions(text);
    try {await navigator.clipboard.writeText(text); setSkillMessage('安装说明已复制');}
    catch {setSkillMessage('无法访问剪贴板，请选中下方说明手动复制。');}
  }

  function reload() {
    moreRequest.current?.abort();
    moreRequest.current = null;
    setLoadingMore(false);
    setPageError(false);
    setRefreshing(true);
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
        return {...current, grants: [...grants.values()], nextCursor: page.nextCursor};
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
    if (actionLock.current || uncertain || reveal || !dialogOpen || list.kind !== 'ready') return;
    const data = new FormData(event.currentTarget);
    const expiration = resolveApiKeyExpiry(expiry, String(data.get('custom-expiry') ?? ''));
    if (!name.trim() || !expiration) {
      setMessage('请填写名称，并选择未来 365 天内的有效到期时间。');
      return;
    }
    if (list.availableScopes && !createScopes.length) {
      setMessage('请至少选择一项读取权限。');
      return;
    }
    actionLock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const scopes = list.availableScopes ? normalizeAgentScopes(createScopes) : permission === 'write' ? ['todo:read', 'todo:write'] : ['todo:read'];
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
      setUncertain(true);
      setMessage('创建结果未确认。请先检查密钥列表，再决定是否重新创建。');
      reload();
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }

  function closeScopeEdit() {
    if (actionLock.current || scopeReadLock.current || scopeEditRef.current?.phase === 'unknown') return;
    updateScopeEdit(null);
    setScopeMessage('');
  }

  async function readCurrentScopes() {
    const pending = scopeEditRef.current;
    if (!pending || scopeReadLock.current) return;
    scopeReadLock.current = true;
    setReadingScopes(true);
    try {
      // A grant may be on an older page. A first-page miss is never readback evidence.
      const cursors = new Set<string>();
      let cursor: string | undefined;
      let found: Grant | undefined;
      do {
        const response = await fetch(endpoint + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), requestOptions);
        if (!response.ok) throw Error();
        const page = await readGrantPage(response);
        found = page.grants.find(grant => grant.id === pending.current.id);
        if (found) break;
        cursor = page.nextCursor;
        if (cursor && cursors.has(cursor)) throw Error();
        if (cursor) cursors.add(cursor);
      } while (cursor);
      if (!found?.grantDigest) throw Error();
      if (pending.phase === 'unknown') {
        if (found.status === 'active' && sameScopes(found.scopes, pending.frozen!.scopes)) {
          updateScopeEdit(null); setMessage('已读回确认密钥权限。'); reload();
        } else {
          // A different snapshot cannot disprove a delayed write. Retain the exact original body and digest.
          updateScopeEdit({...pending,current:found});
          setScopeMessage('结果未确认：当前权限与本次请求不同。原请求已保留，请稍后重新读取；不会自动重发。');
        }
      } else {
        updateScopeEdit({...pending,current:found,phase:'editing',frozen:undefined});
        setScopeMessage('权限已变化，已刷新当前权限并保留拟改权限。请核对后再次确认。');
      }
    } catch {
      setScopeMessage(pending.phase === 'unknown' ? '结果未确认，暂时无法读回当前权限。原请求已保留，请重新读取。' : '暂时无法刷新当前权限，请重新读取后再确认。');
    } finally {scopeReadLock.current = false; setReadingScopes(false);}
  }

  async function setScopes() {
    const edit = scopeEditRef.current;
    if (!edit || edit.phase !== 'editing' || !edit.current.grantDigest || !edit.proposed.length || actionLock.current || scopeReadLock.current) return;
    const frozen = Object.freeze({expectedGrantDigest:edit.current.grantDigest,scopes:normalizeAgentScopes(edit.proposed)});
    const pending: ScopeEdit = {...edit,phase:'saving',frozen};
    updateScopeEdit(pending);
    actionLock.current = true; setBusy(true); setScopeMessage('');
    try {
      const response = await fetch(endpoint + '/' + encodeURIComponent(edit.current.id) + '/scopes', {
        ...requestOptions,method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(frozen),
      });
      if (response.status === 409) {
        updateScopeEdit({...pending,phase:'conflict'});
        await readCurrentScopes();
        return;
      }
      if ([400,401,403,404].includes(response.status)) {
        updateScopeEdit({...pending,phase:'conflict',frozen:undefined});
        setScopeMessage('权限修改被拒绝。请重新读取并核对登录验证、密钥状态和可用权限。');
        return;
      }
      if (!response.ok) throw Error();
      const result: {grant: Grant} = await response.json();
      if (result.grant?.id !== edit.current.id || !result.grant.grantDigest || !sameScopes(result.grant.scopes,frozen.scopes) || result.grant.expiresAt !== edit.current.expiresAt) throw Error();
      updateScopeEdit(null); setMessage('密钥权限已修改。'); reload();
    } catch {
      updateScopeEdit({...pending,phase:'unknown'});
      setScopeMessage('结果未确认。原请求已保留，正在读取当前权限；不会自动重发。');
      await readCurrentScopes();
    } finally {actionLock.current = false; setBusy(false);}
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

  const Surface=embedded?'section':'main';
  return <Surface data-lifeos-surface={embedded?undefined:'auth'} aria-label={embedded?'API 密钥':undefined}>
   <div className={`${styles.page}${embedded?' '+styles.embedded:''}`}>
    {!embedded&&<nav className={styles.nav} aria-label="账户设置">
      <a href="/personal?page=settings">返回设置</a>
    </nav>}
    {!embedded&&<h1>API 密钥</h1>}
    <p>为 LifeOS Skill 授予所需模块的权限。每把密钥都有到期时间，也可以单独撤销。</p>
    {message && !dialogOpen && <p role="status">{message}</p>}
    {list.kind === 'loading' && <p role="status">正在读取密钥…</p>}
    {list.kind === 'disabled' && <p role="status">当前站点尚未启用 API 密钥管理。</p>}
    {list.kind === 'denied' && <p>请<a href="/login">重新登录</a>并完成两步验证。</p>}
    {list.kind === 'error' && <p>暂时无法读取密钥。 <Button type="button" variant="outline" onClick={reload}>重新读取</Button></p>}
    {list.kind === 'ready' && <>
      <section className={styles.section} aria-labelledby="key-list-title">
        <div className={styles.sectionHeading}><h2 id="key-list-title">已签发的密钥</h2>
          <Button ref={newKeyButton} type="button" disabled={busy || uncertain} onClick={event=>prepareCreate(event.currentTarget)}>新建密钥</Button>
        </div>
        {list.grants.length === 0 ? <p>还没有签发密钥。</p> : <ul className={styles.list}>
          {list.grants.map(grant => <li key={grant.id} className={styles.grant}>
            <div>
              <div className={styles.grantHeading}><strong>{grant.name}</strong><Badge variant={grant.status === 'active' ? 'default' : 'secondary'}>{statuses[grant.status]}</Badge></div>
              <p>{describeScopes(grant.scopes)}</p>
              <dl className={styles.details}>
                <div><dt>授权编号</dt><dd><code>{grant.id}</code></dd></div>
                <div><dt>创建</dt><dd><time dateTime={grant.createdAt}>{formatDate(grant.createdAt)}</time></dd></div>
                <div><dt>到期</dt><dd>{grant.expiresAt ? <time dateTime={grant.expiresAt}>{formatDate(grant.expiresAt)}</time> : '未设置'}</dd></div>
              </dl>
            </div>
            {grant.status === 'active' && <div className={styles.actions}>
              {list.availableScopes && grant.grantDigest && <Button type="button" variant="outline" disabled={busy || uncertain || !!reveal}
                aria-label={'修改权限 ' + grant.name} onClick={event => {scopeTrigger.current=event.currentTarget; setScopeMessage(''); updateScopeEdit({current:grant,proposed:grant.scopes,phase:'editing'});}}>修改权限</Button>}
              <Button ref={node=>{if (node) replacementButtons.current.set(grant.id,node); else replacementButtons.current.delete(grant.id);}} type="button" variant="outline" disabled={busy || uncertain || !!reveal} aria-label={'替换 ' + grant.name} onClick={event => prepareCreate(event.currentTarget, grant)}>替换</Button>
              <Button type="button" variant="ghost" disabled={busy || uncertain || !!reveal} aria-label={'撤销 ' + grant.name} onClick={event => {revoker.current = event.currentTarget; setRevoking(grant);}}>撤销</Button>
            </div>}
          </li>)}
        </ul>}
        {pageError && <p role="status">暂时无法读取更多密钥，请重试。</p>}
        {list.nextCursor && <Button type="button" variant="outline" disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? '正在读取…' : '加载更多密钥'}
        </Button>}
      </section>
    </>}
    <section className={styles.section} aria-labelledby="skill-title">
      <h2 id="skill-title">连接你的 AI 工具</h2>
      <p>下载 LifeOS Agent Skill，让 AI 按你的授权管理待办、项目、领域和主题。每位用户使用自己的密钥，安装包不含凭据。</p>
      <div className={styles.actions}>
        <a className={styles.download} href="/api/platform/agent-skill" download="lifeos-agent.tar.gz">下载 LifeOS Agent Skill</a>
        <Button type="button" variant="outline" onClick={copyInstructions}>复制安装说明</Button>
      </div>
      <p className={styles.skillHint}>压缩包附带当前操作清单。解压后安装完整文件夹，再单独配置本站地址和自己的密钥。</p>
      {skillMessage && <p role="status">{skillMessage}</p>}
      {instructions && <details><summary>查看安装和使用说明</summary><pre className={styles.instructions}>{instructions}</pre></details>}
    </section>
    <Dialog open={dialogOpen} onOpenChange={open=>{if (!open) closeDialog();}}>
      {/* Content-local Escape also covers the native layer-registration window. */}
      <DialogContent className={styles.keyDialog} data-lifeos-surface="personal" showCloseButton={false}
        onOpenAutoFocus={event=>{event.preventDefault(); nameInput.current?.focus();}}
        onCloseAutoFocus={event=>{
          event.preventDefault();
          const fallback=creatorGrant.current ? replacementButtons.current.get(creatorGrant.current) : null;
          (creator.current?.isConnected ? creator.current : fallback ?? newKeyButton.current)?.focus();
        }}
        onKeyDown={event=>{if (event.key==='Escape') {event.preventDefault(); event.stopPropagation(); closeDialog();}}}
        onEscapeKeyDown={event=>{event.preventDefault(); event.stopImmediatePropagation(); closeDialog();}}
        onPointerDownOutside={event=>{if (actionLock.current || uncertain) event.preventDefault();}}>
        <DialogTitle ref={revealHeading} tabIndex={-1}>{reveal ? '复制新密钥' : replacement ? '创建替换密钥' : '新建密钥'}</DialogTitle>
        <DialogDescription>{reveal ? '完整密钥只显示这一次。请保存到密码管理器，并在 Skill 中配置。' : replacement ? `正在为「${replacement.name}」创建新密钥。先在 Skill 中验证新密钥，再撤销原密钥。` : '选择本次授权的名称、权限和到期时间。'}</DialogDescription>
        {message && <p role="status">{message}</p>}
        {uncertain && <Button type="button" variant="outline" disabled={refreshing} onClick={reload}>重新读取密钥列表</Button>}
        {reveal ? <>
          <code aria-label="新密钥" className={styles.secret}>{reveal.key}</code>
          <div className={styles.actions}>
            <Button type="button" onClick={copy}>复制密钥</Button>
            <Button type="button" variant="outline" onClick={closeDialog}>关闭密钥</Button>
            {copied && <span role="status">已复制</span>}
          </div>
        </> : <>
        <form method="post" action="/account/api-keys" onSubmit={create}>
          <fieldset className={styles.fields} disabled={busy || uncertain || list.kind !== 'ready'}>
            <label>名称<Input ref={nameInput} name="name" required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="例如：个人待办 Skill"/></label>
            <>{list.kind === 'ready' && list.availableScopes ? <ScopeFields available={list.availableScopes} value={createScopes} onChange={setCreateScopes}/> : <label>权限<select name="permission" value={permission} onChange={event => setPermission(event.target.value)}>
              <option value="read">仅读取待办</option><option value="write">读取和写入待办</option>
            </select></label>}</>
            <label>有效期限<select aria-describedby="key-expiry-hint" name="expiry" value={expiry} onChange={event => setExpiry(event.target.value)}>
              <option value="7">7 天</option><option value="30">30 天</option><option value="90">90 天</option><option value="365">365 天</option><option value="custom">选择到期日期</option>
            </select></label>
            <div id="key-expiry-hint" className={styles.expiryHint}>
              {estimatedExpiry && <small>预计到期：{estimatedExpiry}。 </small>}
              <small>实际到期时间以签发后服务端返回为准。</small>
            </div>
            {expiry === 'custom' && <label className={styles.custom}>自定义到期时间
              <Input type="datetime-local" name="custom-expiry" aria-describedby="key-timezone" required/>
              <small id="key-timezone">时区 {Intl.DateTimeFormat().resolvedOptions().timeZone}，最长 365 天。</small>
            </label>}
            <div className={styles.actions}>
              <Button type="submit">{busy ? '正在处理…' : '创建密钥'}</Button>
            </div>
          </fieldset>
          <Button type="button" variant="outline" disabled={busy || uncertain} onClick={closeDialog}>取消</Button>
        </form>
        </>}
      </DialogContent>
    </Dialog>
    <Dialog open={!!scopeEdit} onOpenChange={open=>{if (!open) closeScopeEdit();}}>
      <DialogContent className={styles.keyDialog} data-lifeos-surface="personal" showCloseButton={false}
        onCloseAutoFocus={event=>{event.preventDefault(); (scopeTrigger.current?.isConnected ? scopeTrigger.current : newKeyButton.current)?.focus();}}
        onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeScopeEdit();}}}
        onEscapeKeyDown={event=>{event.preventDefault();event.stopImmediatePropagation();closeScopeEdit();}}
        onPointerDownOutside={event=>{if(actionLock.current || scopeReadLock.current || scopeEdit?.phase==='unknown')event.preventDefault();}}>
        <DialogTitle>修改密钥权限</DialogTitle>
        <DialogDescription>所有持有该密钥的客户端也会获得这些权限。</DialogDescription>
        {scopeEdit && <>
          <strong>{scopeEdit.current.name}</strong>
          <p>到期：{scopeEdit.current.expiresAt ? formatDate(scopeEdit.current.expiresAt) : '未设置'}（本次修改不会延长）</p>
          <div className={styles.scopeSummary}><p>当前权限：{describeScopes(scopeEdit.current.scopes)}</p><p>拟改权限：{describeScopes(scopeEdit.proposed)}</p></div>
          <ScopeFields available={list.kind === 'ready' ? list.availableScopes ?? [] : []} value={scopeEdit.proposed}
            disabled={busy || readingScopes || scopeEdit.phase !== 'editing'} onChange={proposed=>updateScopeEdit({...scopeEdit,proposed})}/>
          {scopeMessage && <p role="status">{scopeMessage}</p>}
          {(scopeEdit.phase==='unknown' || scopeEdit.phase==='conflict') && <Button type="button" variant="outline" disabled={busy || readingScopes} onClick={readCurrentScopes}>重新读取当前权限</Button>}
          <div className={styles.actions}>
            <Button type="button" variant="outline" disabled={busy || readingScopes || scopeEdit.phase==='unknown'} onClick={closeScopeEdit}>取消</Button>
            <Button type="button" disabled={busy || readingScopes || scopeEdit.phase!=='editing' || !scopeEdit.proposed.length || scopeEdit.current.status!=='active' || sameScopes(scopeEdit.current.scopes,scopeEdit.proposed)} onClick={setScopes}>确认修改权限</Button>
          </div>
        </>}
      </DialogContent>
    </Dialog>
    <Dialog open={!!revoking} onOpenChange={open => {if (!open && !actionLock.current) setRevoking(null);}}>
      <DialogContent className={styles.keyDialog} data-lifeos-surface="personal" showCloseButton={false} onCloseAutoFocus={event => {
        event.preventDefault();
        if (revoker.current?.isConnected) revoker.current.focus();
      }}>
        <DialogTitle>撤销密钥</DialogTitle>
        <DialogDescription>撤销「{revoking?.name}」后，所有使用这把密钥的客户端将无法继续访问其授权的数据。</DialogDescription>
        <div className={styles.actions}>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setRevoking(null)}>取消</Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={revoke}>{busy ? '正在撤销…' : '确认撤销'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </div></Surface>;
}
