'use client';

import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Button} from '../ui-review/ui/button';
import {Input} from '../ui-review/ui/input';
import {
 isManagedClientReplacement,managedClientPath,parseManagedClientWriteCommand,readManagedClientSetup,
 type ManagedClientWriteCommand,type ManagedClientSetup,
} from './managed-client-contract';
import s from './managed-client-panel.module.css';

const storageKey='lifeos-managed-chatgpt-command-v1';

function currentRevision(setup:ManagedClientSetup){
 return setup.registered?(setup.revision??setup.commandId):null;
}

function isSaved(setup:ManagedClientSetup,command:ManagedClientWriteCommand){
 return setup.registered&&setup.commandId===command.commandId&&setup.callback===command.callback;
}

function canRetry(setup:ManagedClientSetup,command:ManagedClientWriteCommand){
 return isManagedClientReplacement(command)
  ?currentRevision(setup)===command.expectedRevision
  :!setup.registered;
}

export function ManagedClientPanel({initial,initialConflict=false}:{initial:ManagedClientSetup|null;initialConflict?:boolean}){
 const [configuration,setConfiguration]=useState(initial);
 const [editRevision,setEditRevision]=useState<string|null>(null);
 const [callback,setCallback]=useState('');
 const [pending,setPending]=useState<ManagedClientWriteCommand|null>(null);
 const [recovery,setRecovery]=useState<'check'|'retry'|'discard'>('check');
 const [busy,setBusy]=useState(false),[hydrated,setHydrated]=useState(false);
 const [needsLogin,setNeedsLogin]=useState(false);
 const [message,setMessage]=useState(initialConflict?'当前客户端配置存在冲突，请核对保存结果。':'');
 const working=useRef(false);
 const input=useRef<HTMLInputElement>(null);
 const editButton=useRef<HTMLButtonElement>(null);

 function retain(command:ManagedClientWriteCommand|null){
  setPending(command);
  setRecovery('check');
  try{
   if(command)sessionStorage.setItem(storageKey,JSON.stringify(command));
   else sessionStorage.removeItem(storageKey);
  }catch{/* The current tab keeps the command in memory when storage is unavailable. */}
 }

 useEffect(()=>{
  try{
   const value=sessionStorage.getItem(storageKey);
   const command=value&&parseManagedClientWriteCommand(JSON.parse(value));
   if(command&&initial&&isSaved(initial,command))sessionStorage.removeItem(storageKey);
   else if(command){
    setPending(command);setCallback(command.callback);
    setMessage('上次的请求已保留。请先核对保存结果。');
   }
  }catch{/* Unusable browser storage does not prevent a new in-page request. */}
  setHydrated(true);
 },[initial]);

 useEffect(()=>{
  if(editRevision&&!pending)input.current?.focus();
 },[editRevision,pending]);

 useEffect(()=>{
  if(!pending)return;
  const leave=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
  window.addEventListener('beforeunload',leave);
  return()=>window.removeEventListener('beforeunload',leave);
 },[pending]);

 function closeEditor(){
  setEditRevision(null);setCallback('');
  requestAnimationFrame(()=>editButton.current?.focus());
 }

 function showSaved(next:ManagedClientSetup,command:ManagedClientWriteCommand){
  retain(null);setConfiguration(next);closeEditor();
  setMessage(isManagedClientReplacement(command)
   ?'回调地址已更换。请返回当前 ChatGPT 草稿，重新完成授权。'
   :'连接配置已保存。请返回 ChatGPT 完成连接授权。');
 }

 function checkSession(response:Response){
  const expired=response.status===401;
  setNeedsLogin(expired);
  if(expired)setMessage('请在新标签页重新登录 LifeOS，然后回到本页核对保存结果。');
  return !expired;
 }

 async function check(){
  if(working.current||!hydrated)return;
  working.current=true;setBusy(true);setRecovery('check');
  try{
   const response=await fetch(managedClientPath,{cache:'no-store'});
   if(!checkSession(response))return;
   const next=response.ok&&readManagedClientSetup((await response.json()).configuration);
   if(!next)throw Error('unverified');
   setConfiguration(next);
   if(pending){
    if(isSaved(next,pending))showSaved(next,pending);
    else if(canRetry(next,pending)){
     setRecovery('retry');setMessage('服务端仍是提交前的配置。可以使用原请求重试。');
    }else{
     setRecovery('discard');setMessage('配置已在其他操作中更改。请使用最新配置，再决定是否更换。');
    }
   }else if(editRevision&&editRevision!==currentRevision(next)){
    closeEditor();setMessage('配置已更新，已载入当前地址。请重新开始更换。');
   }else setMessage(next.registered?'已读取当前连接配置。':'尚未保存连接配置。');
  }catch{setMessage('暂时无法核对，请保留本页后再试。');}
  finally{working.current=false;setBusy(false);}
 }

 async function save(event?:FormEvent){
  event?.preventDefault();
  if(working.current||!hydrated||!configuration)return;
  if(pending?recovery!=='retry':configuration.registered&&editRevision!==currentRevision(configuration))return;
  const command=pending??parseManagedClientWriteCommand({
   callback,commandId:crypto.randomUUID(),...(editRevision?{expectedRevision:editRevision}:{}),
  });
  if(!command){setMessage('请输入当前 ChatGPT 草稿给出的完整回调地址。');return;}
  if(!pending&&configuration.registered&&configuration.callback===command.callback){
   setMessage('这是当前回调地址，请粘贴新的地址。');return;
  }
  working.current=true;setBusy(true);retain(command);setMessage('正在保存…');
  try{
   const response=await fetch(managedClientPath,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(command)});
   if(!checkSession(response))return;
   if(response.status===400){
    retain(null);setEditRevision(isManagedClientReplacement(command)?command.expectedRevision:null);
    setMessage('回调地址未通过检查，请核对后重新填写。');return;
   }
   if(!response.ok)throw Error('unverified');
   const result=await response.json(),next=readManagedClientSetup(result.configuration);
   if(result.verified!==true||!next||!isSaved(next,command))throw Error('unverified');
   showSaved(next,command);
  }catch{setMessage('保存结果未确认。请先核对保存结果，原请求已保留。');}
  finally{working.current=false;setBusy(false);}
 }

 const replacing=!!editRevision||(!!pending&&isManagedClientReplacement(pending));
 const editing=!!configuration&&(!configuration.registered||replacing)&&!pending;
 return <main data-lifeos-surface="auth" className={s.page}><section className={s.card} aria-labelledby="managed-client-title">
  <h1 id="managed-client-title">ChatGPT 连接设置</h1>
  <p>{configuration?.registered?'在 ChatGPT 的自定义 OAuth 客户端中使用以下连接配置。':'在 ChatGPT 的高级 OAuth 设置中选择「用户自定义 OAuth 客户端」和「none」，然后复制该草稿的回调 URL。'}</p>
  {configuration?.registered&&<section aria-labelledby="managed-saved-title">
   <h2 id="managed-saved-title">已保存的配置</h2>
   <p className={s.value}>当前 ChatGPT 回调地址：{configuration.callback}</p>
   {!editing&&!pending&&<Button ref={editButton} type="button" variant="outline" disabled={!hydrated||busy} onClick={()=>{
    setEditRevision(currentRevision(configuration));setCallback('');setMessage('');
   }}>更换回调地址</Button>}
  </section>}
  {!configuration&&<p>连接设置暂不可用。请稍后核对。</p>}
  {editing&&<form method="post" action="/account/mcp" onSubmit={save}><fieldset disabled={!hydrated||busy}>
   <label htmlFor="managed-client-callback">{replacing?'新的 ChatGPT 回调地址':'ChatGPT 回调地址'}</label>
   <Input ref={input} id="managed-client-callback" name="callback" type="url" required maxLength={180} autoComplete="off" autoCapitalize="none" spellCheck={false} value={callback} onChange={event=>setCallback(event.target.value)} placeholder="https://chatgpt.com/connector/oauth/…" aria-describedby="managed-client-callback-hint"/>
   <p id="managed-client-callback-hint">{replacing?'粘贴当前 ChatGPT 草稿的完整回调 URL。保存后，原地址失效，请在 ChatGPT 重新授权。':'请粘贴这次 ChatGPT 连接页面显示的完整回调 URL。'}</p>
   <div className={s.actions}>
    <Button type="submit">{replacing?'保存新回调地址':'保存连接配置'}</Button>
    {replacing&&<Button type="button" variant="outline" onClick={()=>{closeEditor();setMessage('');}}>取消更换</Button>}
   </div>
  </fieldset></form>}
  {pending&&<p className={s.value}>本次提交的回调地址：{pending.callback}</p>}
  {message&&<p role="status" aria-live="polite">{message}</p>}
  {needsLogin&&<a href="/login?reauthenticate=1" target="_blank" rel="noopener noreferrer">在新标签页登录 LifeOS</a>}
  <div className={s.actions}>
   <Button type="button" variant="outline" disabled={!hydrated||busy} onClick={check}>核对保存结果</Button>
   {pending&&recovery==='retry'&&<Button type="button" disabled={busy} onClick={()=>save()}>使用原请求重试</Button>}
   {pending&&recovery==='discard'&&<Button type="button" disabled={busy} onClick={()=>{
    retain(null);closeEditor();setMessage('已放弃旧请求，当前显示最新配置。');
   }}>放弃旧请求，使用最新配置</Button>}
  </div>
  {configuration&&<><h2>填写到 ChatGPT</h2><dl className={s.details}>
   {Object.entries({'MCP 地址':configuration.resource,'客户端 ID':configuration.clientId,'授权地址':configuration.authorizationEndpoint,'Token 地址':configuration.tokenEndpoint,'Scopes':configuration.scopes.join(' '),'Token 认证方式':configuration.tokenEndpointAuthMethod,'PKCE':configuration.codeChallengeMethod}).map(([label,value])=><div key={label}><dt>{label}</dt><dd className={s.value}>{value}</dd></div>)}
  </dl><p>连接需要本人登录、两步验证及同意授权。写入业务内容仍需明确请求。</p></>}
  <a href="/personal?page=settings&amp;panel=general">返回设置</a>
 </section></main>;
}
