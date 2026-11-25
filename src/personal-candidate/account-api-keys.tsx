'use client';

import {useCallback,useEffect, useRef, useState, type FormEvent} from 'react';
import {FilePermissionPanel} from '../file-handoff/permission-panel';
import {filePermissionStateSchema,type FilePermission} from '../file-handoff/permission-contracts';
import {flushSync} from 'react-dom';
import {Badge} from '../ui-review/ui/badge';
import {Button} from '../ui-review/ui/button';
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '../ui-review/ui/dialog';
import {Input} from '../ui-review/ui/input';
import {agentScopes, normalizeAgentScopes, type AgentScope} from '../agent-api/scopes';
import {allPersonalBusinessPolicy,type BusinessDataPolicy} from '../agent-api/business-policy';
import {estimateApiKeyExpiry, resolveApiKeyExpiry} from './account-api-key-expiry';
import styles from './account-api-keys.module.css';

const endpoint = '/api/platform/account/api-keys';
const reauthenticateHref = '/login?reauthenticate=1&return_to=' + encodeURIComponent('/personal?page=settings&panel=api-keys');
const skillPath = '/api/platform/agent-skill';

function skillInstructions() {
  return [
    'LifeOS Skill 安装说明',
    '1. 从 ' + new URL(skillPath, window.location.origin).href + ' 下载并解压 lifeos-agent.tar.gz。',
    '2. 将 lifeos-agent 目录连同 references 放入客户端支持的 Skill 目录。',
    '3. 按 references/credential-runtime.md 配置受审查的凭据运行时。密钥单独保存在系统凭据库或客户端的安全配置中。',
    '4. 首次使用先发现当前权限与可用操作，再执行已授权的操作。',
  ].join('\n');
}
const statuses = {active: '有效', expired: '已到期', revoked: '已撤销'};
type Grant = {
  fileHandoff?:FilePermission;
  id: string;
  name: string;
  scopes: readonly AgentScope[];
  grantDigest?: string;
  businessDataPolicy?:BusinessDataPolicy;
  createdAt: string;
  expiresAt: string | null;
  status: keyof typeof statuses;
};
const listErrors = {
  network: '无法连接密钥服务。请重试。',
  unavailable: '密钥服务暂时无法返回列表。请重试。',
  rateLimited: '读取请求过于频繁。请稍后重试。',
  invalidResponse: '密钥列表返回格式有误。请重试。',
};
type List = {kind: 'loading' | 'disabled' | 'reauthenticate' | 'denied'}
  | {kind: 'error'; reason: keyof typeof listErrors}
  | {kind: 'ready'; grants: Grant[]; nextCursor?: string; availableScopes?: readonly AgentScope[];availablePolicies?:readonly BusinessDataPolicy[];availableFileHandoff?:'file-handoff-v1'};
const requestOptions = {cache: 'no-store', credentials: 'same-origin'} as const;
async function readGrantPage(response: Response) {
  const data: {keys: Grant[]; nextCursor?: string; availableScopes?: readonly AgentScope[];availablePolicies?:readonly BusinessDataPolicy[];availableFileHandoff?:'file-handoff-v1'} = await response.json();
  if (!Array.isArray(data.keys) ||
      (data.nextCursor !== undefined && (typeof data.nextCursor !== 'string' || !data.nextCursor))) throw Error();
  for (const grant of data.keys) {
    if (!grant || typeof grant.id !== 'string' || !grant.id || typeof grant.name !== 'string' ||
        !Object.hasOwn(statuses, grant.status) ||
        typeof grant.createdAt !== 'string' || !Number.isFinite(Date.parse(grant.createdAt)) ||
        (grant.expiresAt !== null && (typeof grant.expiresAt !== 'string' || !Number.isFinite(Date.parse(grant.expiresAt))))) throw Error();
    normalizeAgentScopes(grant.scopes);
  }
  if(data.availablePolicies!==undefined&&(!Array.isArray(data.availablePolicies)||data.availablePolicies.some(policy=>policy!==allPersonalBusinessPolicy)))throw Error();
  if(data.keys.some(grant=>grant.businessDataPolicy!==undefined&&grant.businessDataPolicy!==allPersonalBusinessPolicy))throw Error();
  if(data.availableFileHandoff!==undefined&&data.availableFileHandoff!=='file-handoff-v1')throw Error();
  for(const grant of data.keys)if(grant.fileHandoff)filePermissionStateSchema.parse(grant.fileHandoff);
  return {availableFileHandoff:data.availableFileHandoff,availablePolicies:data.availablePolicies,grants: data.keys, nextCursor: data.nextCursor, availableScopes: data.availableScopes === undefined ? undefined : normalizeAgentScopes(data.availableScopes)};
}

const scopeModules = [{id: 'todo', label: '待办'}, {id: 'organization', label: '项目、领域和主题'}, {id:'requirements',label:'需求'}] as const;
const describeScopes = (scopes: readonly AgentScope[]) => scopeModules.filter(module => scopes.includes(`${module.id}:read`))
  .map(module => `${module.label}：${scopes.includes(`${module.id}:write`) ? '读取和写入' : '仅读取'}`).join('；') || '未选择权限';
const sameScopes = (a: readonly AgentScope[], b: readonly AgentScope[]) => a.length === b.length && a.every(scope => b.includes(scope));
const describePolicy=(policy:BusinessDataPolicy|null|undefined,scopes:readonly AgentScope[])=>policy?'全部个人业务数据读写（含后续已上线业务模块）':describeScopes(scopes);
function PolicyFields({value,onChange,disabled=false,allAvailable=true}: {value:BusinessDataPolicy|null;onChange:(value:BusinessDataPolicy|null)=>void;disabled?:boolean;allAvailable?:boolean}){
  return <label className={styles.policyFields}>授权方式<select value={value??'explicit'} disabled={disabled} onChange={event=>onChange(event.target.value===allPersonalBusinessPolicy?allPersonalBusinessPolicy:null)}>
    <option value="explicit">按模块选择权限</option><option value={allPersonalBusinessPolicy} disabled={!allAvailable}>全部个人业务数据读写（含后续已上线业务模块）</option></select>
    {value&&<small>所有持有这把密钥的客户端均可读写当前及后续已启用的个人业务模块。实际能力以发现结果为准；不包含账户安全、密钥管理、系统设置、外部付款或下单及不可逆操作。文件交接需单独授权。</small>}</label>;
}
type ScopeEdit = {current: Grant; proposed: readonly AgentScope[];proposedPolicy?:BusinessDataPolicy|null; phase: 'editing' | 'saving' | 'conflict' | 'unknown';
  frozen?: Readonly<{expectedGrantDigest: string; scopes: readonly AgentScope[];businessDataPolicy?:BusinessDataPolicy|null}>};

function ScopeFields({available, value, onChange, disabled=false}: {available: readonly AgentScope[]; value: readonly AgentScope[];
  onChange: (value: readonly AgentScope[]) => void; disabled?: boolean}) {
  function change(scope: AgentScope, checked: boolean) {
    const next = new Set(value);
    const [module, action] = scope.split(':') as ['todo' | 'organization' | 'requirements', 'read' | 'write'];
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
  const [skillCopy, setSkillCopy] = useState<{kind:'copied'} | {kind:'manual'; instructions:string} | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pageError, setPageError] = useState(false);
  const [name, setName] = useState('');
  const [permission, setPermission] = useState('read');
  const [createPolicy,setCreatePolicy]=useState<BusinessDataPolicy|null>(null);
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
  const creator = useRef<HTMLButtonElement | null>(null);
  const creatorGrant = useRef<string | null>(null);
  const newKeyButton = useRef<HTMLButtonElement>(null);
  const replacementButtons = useRef(new Map<string,HTMLButtonElement>());
  const [message, setMessage] = useState('');
  const [ownBusy, setBusy] = useState(false),[fileBusy,setFileBusy]=useState(false);const busy=ownBusy||fileBusy;
  const nameInput = useRef<HTMLInputElement>(null);
  const revealHeading = useRef<HTMLHeadingElement>(null);
  const revoker = useRef<HTMLButtonElement | null>(null);
  const pageActive = useRef(true);
  const actionLock = useRef(false);
  const moreRequest = useRef<AbortController | null>(null);
  const lockFile=useCallback((value:boolean)=>{actionLock.current=value;setFileBusy(value);},[]);
  const fileSaved=useCallback((grant:Grant)=>setList(current=>current.kind==='ready'?{...current,grants:current.grants.map(item=>item.id===grant.id?grant:item)}:current),[]);
  const readyList = list.kind === 'ready' ? list : null;
  const canCreate = !!readyList || list.kind === 'error';
  const canSubmit = !!readyList || (list.kind === 'error' && !replacement);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      let reason: keyof typeof listErrors = 'network';
      try {
        const response = await fetch(endpoint, {...requestOptions, signal: controller.signal});
        if (controller.signal.aborted) return;
        if (response.status === 404) return setList({kind: 'disabled'});
        if (response.status === 401) return setList({kind: 'reauthenticate'});
        if (response.status === 403) return setList({kind: 'denied'});
        if (!response.ok) return setList({kind: 'error', reason: response.status === 429 ? 'rateLimited' : 'unavailable'});
        reason = 'invalidResponse';
        const page = await readGrantPage(response);
        if (!controller.signal.aborted) {
          setList({kind: 'ready', ...page});
          setUncertain(false);
        }
      } catch {
        if (!controller.signal.aborted) setList({kind: 'error', reason});
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
    setCreatePolicy(grant?.businessDataPolicy??null);
    setName(grant?.name ?? '');
    setPermission(grant?.scopes.includes('todo:write') ? 'write' : 'read');
    setCreateScopes(grant?.scopes ?? ['todo:read']);
    setExpiry('30');
    setMessage('');
    setDialogOpen(true);
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
    if (actionLock.current || uncertain || reveal || refreshing || !dialogOpen || !canSubmit) return;
    const data = new FormData(event.currentTarget);
    const expiration = resolveApiKeyExpiry(expiry, String(data.get('custom-expiry') ?? ''));
    if (!name.trim() || !expiration) {
      setMessage('请填写名称，并选择未来 365 天内的有效到期时间。');
      return;
    }
    if (readyList?.availableScopes && !createScopes.length) {
      setMessage('请至少选择一项读取权限。');
      return;
    }
    actionLock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const policy = readyList ? createPolicy : null;
      const scopes = readyList?.availableScopes ? normalizeAgentScopes(createScopes) :
        readyList && permission === 'write' ? ['todo:read', 'todo:write'] : ['todo:read'];
      const response = await fetch(endpoint, {
        ...requestOptions,
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: name.trim(), scopes, ...expiration,...(policy?{businessDataPolicy:policy}:{})}),
      });
      if (response.status === 400) {
        setMessage('创建请求未通过。请核对名称、权限和到期时间。');
        return;
      }
      if (response.status === 401 || response.status === 403) {
        setList({kind: response.status === 401 ? 'reauthenticate' : 'denied'});
        setMessage(response.status === 401
          ? '当前会话无权创建密钥。请关闭窗口，在密钥页重新验证。'
          : '当前会话无权创建密钥。');
        return;
      }
      if (response.status === 404) {
        setList({kind: 'disabled'});
        setMessage('当前站点尚未启用 API 密钥管理。');
        return;
      }
      if (!response.ok) throw Error();
      const result: {key: string; grant: Grant} = await response.json();
      if (typeof result.key !== 'string' || !result.key || !result.grant?.id || (result.grant.businessDataPolicy??null)!==policy) throw Error();
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
        if (found.status === 'active' && sameScopes(found.scopes, pending.frozen!.scopes) && (found.businessDataPolicy??null)===(pending.frozen!.businessDataPolicy??null)) {
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
    const frozen = Object.freeze({expectedGrantDigest:edit.current.grantDigest,scopes:normalizeAgentScopes(edit.proposed),...(edit.proposedPolicy!==undefined?{businessDataPolicy:edit.proposedPolicy}:{})});
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
      if (result.grant?.id !== edit.current.id || !result.grant.grantDigest || !sameScopes(result.grant.scopes,frozen.scopes) || (result.grant.businessDataPolicy??null)!==(frozen.businessDataPolicy??null) || result.grant.expiresAt !== edit.current.expiresAt) throw Error();
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

  async function copySkillInstructions() {
    const instructions = skillInstructions();
    try {
      await navigator.clipboard.writeText(instructions);
      setSkillCopy({kind:'copied'});
    } catch {
      setSkillCopy({kind:'manual', instructions});
    }
  }

  const Surface=embedded?'section':'main';
  return <Surface data-lifeos-surface={embedded?undefined:'auth'} aria-label={embedded?'API 密钥':undefined}>
   <div className={`${styles.page}${embedded?' '+styles.embedded:''}`}>
    {!embedded&&<nav className={styles.nav} aria-label="账户设置">
      <a href="/personal?page=settings">返回设置</a>
    </nav>}
    {!embedded&&<h1>API 密钥</h1>}
    <p>完整密钥只在创建成功时显示一次。列表显示名称、权限、状态和到期时间。</p>
    {message && !dialogOpen && <p role="status">{message}</p>}
    <section className={styles.section} aria-labelledby="key-list-title" aria-busy={list.kind === 'loading' || refreshing}>
      <div className={styles.sectionHeading}><h2 id="key-list-title">已签发的密钥</h2>
        {canCreate && <Button ref={newKeyButton} type="button" disabled={busy || uncertain} onClick={event=>prepareCreate(event.currentTarget)}>新建密钥</Button>}
      </div>
      {(list.kind === 'loading' || refreshing) && <p role="status">正在读取密钥…</p>}
      {list.kind === 'disabled' && <p role="status">当前站点尚未启用 API 密钥管理。</p>}
      {list.kind === 'reauthenticate' && <p role="status">查看密钥列表需要重新验证。请<a href={reauthenticateHref}>重新登录</a>，完成两步验证后返回本页。</p>}
      {list.kind === 'denied' && <p role="status">当前会话无权管理密钥。请确认你使用的是 LifeOS 本人账号。</p>}
      {list.kind === 'error' && !refreshing && <div className={styles.actions}>
        <p role="alert">{listErrors[list.reason]}</p>
        <Button type="button" variant="outline" onClick={reload}>重新读取</Button>
      </div>}
      {list.kind === 'ready' && <>
        {list.grants.length === 0 ? <p>还没有签发密钥。</p> : <ul className={styles.list}>
          {list.grants.map(grant => <li key={grant.id} className={styles.grant}>
            <div>
              <div className={styles.grantHeading}><strong>{grant.name}</strong><Badge variant={grant.status === 'active' ? 'default' : 'secondary'}>{statuses[grant.status]}</Badge></div>
              <p>{describePolicy(grant.businessDataPolicy,grant.scopes)}</p>
              {grant.fileHandoff&&<p>文件交接：{grant.fileHandoff.scopes.length?grant.fileHandoff.scopes.includes('file-handoff:write')?'读取与保存':'仅读取':'未授权'}{grant.fileHandoff.consumer==='codex'?'；已授权 Codex 领取端':''}</p>}
              <dl className={styles.details}>
                <div><dt>授权编号</dt><dd><code>{grant.id}</code></dd></div>
                <div><dt>创建</dt><dd><time dateTime={grant.createdAt}>{formatDate(grant.createdAt)}</time></dd></div>
                <div><dt>到期</dt><dd>{grant.expiresAt ? <time dateTime={grant.expiresAt}>{formatDate(grant.expiresAt)}</time> : '未设置'}</dd></div>
              </dl>
            </div>
            {grant.status === 'active' && <div className={styles.actions}>
              {list.availableFileHandoff&&grant.grantDigest&&<FilePermissionPanel grant={grant} disabled={busy||uncertain||!!reveal} onLock={lockFile} onSaved={fileSaved}/>}
              {list.availableScopes && grant.grantDigest && <Button type="button" variant="outline" disabled={busy || uncertain || !!reveal}
                aria-label={'修改权限 ' + grant.name} onClick={event => {scopeTrigger.current=event.currentTarget; setScopeMessage(''); updateScopeEdit({current:grant,proposed:grant.scopes,...(list.availablePolicies||grant.businessDataPolicy?{proposedPolicy:grant.businessDataPolicy??null}:{}),phase:'editing'});}}>修改权限</Button>}
              <Button ref={node=>{if (node) replacementButtons.current.set(grant.id,node); else replacementButtons.current.delete(grant.id);}} type="button" variant="outline" disabled={busy || uncertain || !!reveal} aria-label={'替换 ' + grant.name} onClick={event => prepareCreate(event.currentTarget, grant)}>替换</Button>
              <Button type="button" variant="ghost" disabled={busy || uncertain || !!reveal} aria-label={'撤销 ' + grant.name} onClick={event => {revoker.current = event.currentTarget; setRevoking(grant);}}>撤销</Button>
            </div>}
          </li>)}
        </ul>}
        {pageError && <p role="status">暂时无法读取更多密钥，请重试。</p>}
        {list.nextCursor && <Button type="button" variant="outline" disabled={loadingMore} onClick={loadMore}>
          {loadingMore ? '正在读取…' : '加载更多密钥'}
        </Button>}
      </>}
    </section>
    <section className={styles.section} aria-labelledby="skill-install-title">
      <div className={styles.sectionHeading}>
        <h2 id="skill-install-title">LifeOS Skill</h2>
        <div className={styles.actions}>
          <Button asChild variant="outline"><a href={skillPath} download>下载 Skill</a></Button>
          <Button type="button" variant="outline" onClick={copySkillInstructions}>复制安装说明</Button>
        </div>
      </div>
      {skillCopy?.kind === 'copied' && <p role="status">已复制安装说明。</p>}
      {skillCopy?.kind === 'manual' && <>
        <p role="status">无法访问剪贴板，请手动复制安装说明。</p>
        <textarea aria-label="Skill 安装说明" className={styles.skillInstructions} readOnly rows={6}
          value={skillCopy.instructions} onFocus={event=>event.currentTarget.select()}/>
      </>}
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
          <fieldset className={styles.fields} disabled={busy || uncertain || refreshing || !canSubmit}>
            <label>名称<Input ref={nameInput} name="name" required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="例如：个人待办 Skill"/></label>
            {list.kind==='ready'&&(list.availablePolicies?.includes(allPersonalBusinessPolicy)||createPolicy)&&<PolicyFields value={createPolicy} allAvailable={list.availablePolicies?.includes(allPersonalBusinessPolicy)===true} onChange={policy=>{setCreatePolicy(policy);if(policy&&!createScopes.length)setCreateScopes(['todo:read']);}}/>}
            {list.kind === 'error' && !replacement && <p className={styles.expiryHint}>列表恢复前，新密钥仅可读取待办。</p>}
            {readyList&&!createPolicy&&<>{readyList.availableScopes ? <ScopeFields available={readyList.availableScopes} value={createScopes} onChange={setCreateScopes}/> : <label>权限<select name="permission" value={permission} onChange={event => setPermission(event.target.value)}>
              <option value="read">仅读取待办</option><option value="write">读取和写入待办</option>
            </select></label>}</>}
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
          <div className={styles.scopeSummary}><p>当前权限：{describePolicy(scopeEdit.current.businessDataPolicy,scopeEdit.current.scopes)}</p><p>拟改权限：{describePolicy(scopeEdit.proposedPolicy,scopeEdit.proposed)}</p></div>
          {(list.kind==='ready'&&list.availablePolicies?.includes(allPersonalBusinessPolicy)||scopeEdit.current.businessDataPolicy)&&<PolicyFields value={scopeEdit.proposedPolicy??null} allAvailable={list.kind==='ready'&&list.availablePolicies?.includes(allPersonalBusinessPolicy)===true} disabled={busy||readingScopes||scopeEdit.phase!=='editing'} onChange={proposedPolicy=>updateScopeEdit({...scopeEdit,proposedPolicy,...(proposedPolicy&&!scopeEdit.proposed.length?{proposed:['todo:read'] as const}:{})})}/>}
          {!scopeEdit.proposedPolicy&&<ScopeFields available={list.kind === 'ready' ? list.availableScopes ?? [] : []} value={scopeEdit.proposed}
            disabled={busy || readingScopes || scopeEdit.phase !== 'editing'} onChange={proposed=>updateScopeEdit({...scopeEdit,proposed})}/> }
          {scopeMessage && <p role="status">{scopeMessage}</p>}
          {(scopeEdit.phase==='unknown' || scopeEdit.phase==='conflict') && <Button type="button" variant="outline" disabled={busy || readingScopes} onClick={readCurrentScopes}>重新读取当前权限</Button>}
          <div className={styles.actions}>
            <Button type="button" variant="outline" disabled={busy || readingScopes || scopeEdit.phase==='unknown'} onClick={closeScopeEdit}>取消</Button>
            <Button type="button" disabled={busy || readingScopes || scopeEdit.phase!=='editing' || !scopeEdit.proposed.length || scopeEdit.current.status!=='active' || (sameScopes(scopeEdit.current.scopes,scopeEdit.proposed)&&(scopeEdit.current.businessDataPolicy??null)===(scopeEdit.proposedPolicy??null))} onClick={setScopes}>确认修改权限</Button>
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
