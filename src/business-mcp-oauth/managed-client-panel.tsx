'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Button} from '../ui-review/ui/button';import {Input} from '../ui-review/ui/input';
import {managedClientPath,parseManagedClientCommand,readManagedClientSetup,type ManagedClientCommand,type ManagedClientSetup} from './managed-client-contract';
import s from './managed-client-panel.module.css';
const storageKey='lifeos-managed-chatgpt-command-v1';
export function ManagedClientPanel({initial,initialConflict=false}:{initial:ManagedClientSetup|null;initialConflict?:boolean}){
 const[configuration,setConfiguration]=useState(initial),[callback,setCallback]=useState(initial?.registered?initial.callback:''),[pending,setPending]=useState<ManagedClientCommand|null>(null),[busy,setBusy]=useState(false),[hydrated,setHydrated]=useState(false),[conflict,setConflict]=useState(initialConflict),[message,setMessage]=useState('');
 const working=useRef(false);
 function retain(command:ManagedClientCommand|null){setPending(command);try{if(command)sessionStorage.setItem(storageKey,JSON.stringify(command));else sessionStorage.removeItem(storageKey);}catch{/* The immutable in-page command and departure guard remain available. */}}
 useEffect(()=>{
  try{const value=sessionStorage.getItem(storageKey),command=value?parseManagedClientCommand(JSON.parse(value)):null;
   if(command&&initial?.registered&&initial.commandId===command.commandId&&initial.callback===command.callback)sessionStorage.removeItem(storageKey);
   else if(command){setPending(command);setCallback(command.callback);setMessage('已保留上次请求。请先核对保存结果；本页不会自动重发。');}
  }catch{/* No stored request is trusted without validation. */}setHydrated(true);
 },[initial]);
 useEffect(()=>{if(!pending)return;const leave=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);},[pending]);
 async function check(){
  if(working.current||!hydrated)return;working.current=true;setBusy(true);
  try{const response=await fetch(managedClientPath,{cache:'no-store'});if(!response.ok){if(response.status===409)setConflict(true);throw Error('readback');}
   const next=readManagedClientSetup((await response.json()).configuration);if(!next)throw Error('projection');setConfiguration(next);
   if(pending){if(next.registered&&next.callback===pending.callback&&next.commandId===pending.commandId){retain(null);setConflict(false);setMessage('已独立核对，连接配置已保存。');}else if(next.registered){setConflict(true);setMessage('已有另一份连接配置，本页不会覆盖。请保留当前请求并核对。');}else setMessage('暂未读到保存结果，原请求继续保留。可稍后核对或使用原请求重试。');}
   else{setConflict(false);if(next.registered)setCallback(next.callback);setMessage(next.registered?'已读取现有连接配置。':'尚未保存连接配置。');}
  }catch{setMessage('暂时无法核对，请保留本页和原请求后稍后再试。');}finally{working.current=false;setBusy(false);}
 }
 async function save(event?:FormEvent){
  event?.preventDefault();if(working.current||!hydrated||conflict||configuration?.registered||!configuration)return;
  const command=pending??parseManagedClientCommand({callback,commandId:crypto.randomUUID()});
  if(!command){setMessage('请输入 ChatGPT 提供的完整回调地址，不能包含查询参数或片段。');return;}
  working.current=true;setBusy(true);retain(command);setMessage('正在保存连接配置…');
  try{const response=await fetch(managedClientPath,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(command)});
   if(!response.ok){if(response.status===409)setConflict((await response.json()).error?.code==='MANAGED_CLIENT_CONFLICT');if(response.status===400){retain(null);setMessage('回调地址未通过检查，本次未提交。请核对后重新填写。');return;}throw Error('unknown');}
   const value=await response.json(),next=readManagedClientSetup(value.configuration);
   if(value.verified!==true||!next?.registered||next.commandId!==command.commandId||next.callback!==command.callback)throw Error('unverified');
   setConfiguration(next);retain(null);setMessage('连接配置已保存。请返回 ChatGPT 完成连接授权。');
  }catch{setMessage('保存结果未确认，原请求已保留。请先核对保存结果，不要另建请求。');}finally{working.current=false;setBusy(false);}
 }
 return <main data-lifeos-surface="auth" className={s.page}><section className={s.card} aria-labelledby="managed-client-title">
  <h1 id="managed-client-title">ChatGPT 连接设置</h1>
  <p>{configuration?.registered?'已保存的连接配置如下。请将这些信息填写到 ChatGPT，继续完成连接。':'在 ChatGPT 的自定义 MCP 高级 OAuth 设置中选择「用户自定义 OAuth 客户端」与「none」，将页面提供的回调地址填入下方。'}</p>
  <p>这里只保存连接配置。访问仍需本人两步验证、连接同意与现有业务授权；保存业务内容仍需要明确请求。</p>
  {message&&<p role="status" aria-live="polite">{message}</p>}
  {conflict&&<p role="alert">当前配置存在差异，本页不会覆盖、更新或扩大权限。</p>}
  {!configuration?<p>连接设置暂不可用。请稍后核对。</p>:configuration.registered?<><h2>已保存的配置</h2><p className={s.value}>ChatGPT 回调地址：{configuration.callback}</p></>:<form method="post" action="/account/mcp" onSubmit={save}><fieldset disabled={!hydrated||busy||!!pending||conflict}>
   <label htmlFor="managed-client-callback">ChatGPT 回调地址</label>
   <Input id="managed-client-callback" name="callback" type="url" required maxLength={180} autoComplete="off" autoCapitalize="none" spellCheck={false} value={callback} onChange={event=>setCallback(event.target.value)} placeholder="https://chatgpt.com/connector/oauth/…" aria-describedby="managed-client-callback-hint"/>
   <p id="managed-client-callback-hint">请使用这次 ChatGPT 连接页面显示的地址。</p>
   <Button type="submit">{busy?'正在保存…':'保存连接配置'}</Button>
  </fieldset></form>}
  <div className={s.actions}><Button type="button" variant="outline" disabled={!hydrated||busy} onClick={check}>核对保存结果</Button>{pending&&!conflict&&!configuration?.registered&&<Button type="button" variant="outline" disabled={!hydrated||busy} onClick={()=>save()}>使用原请求重试</Button>}</div>
  {configuration&&<><h2>填写到 ChatGPT</h2><dl className={s.details}>
   {Object.entries({'MCP 地址':configuration.resource,'客户端 ID':configuration.clientId,'授权地址':configuration.authorizationEndpoint,'Token 地址':configuration.tokenEndpoint,'Scopes':configuration.scopes.join(' '),'Token 认证方式':configuration.tokenEndpointAuthMethod,'PKCE':configuration.codeChallengeMethod}).map(([label,value])=><div key={label}><dt>{label}</dt><dd className={s.value}>{value}</dd></div>)}
  </dl><p>请完成 ChatGPT 的连接步骤，并在 LifeOS 核对实际权限后同意连接。普通网页退出不会撤销已授予的连接。</p></>}
  <a href="/personal">返回私人空间</a>
 </section></main>;
}
