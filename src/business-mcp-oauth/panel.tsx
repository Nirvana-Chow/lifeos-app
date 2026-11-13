'use client';
import {useState} from 'react';
import {validOAuthRedirect} from './query';
import type {BusinessOAuthConfig} from './boundary';
import s from '../personal-candidate/login.module.css';
const labels:Record<string,string>={todo:'待办',organization:'项目、领域与主题',requirements:'需求',journal:'日记',calendar:'日历',health:'健康',person:'联系人',finance:'财务',media:'收藏',career:'职业',portfolio:'作品',cooking:'烹饪',feedback:'反馈','storage-review':'文件审阅'};
export function OAuthPanel({query,clientId,scopes,config,continuation=false}:{query:string;clientId:string;scopes:readonly string[];config:BusinessOAuthConfig;continuation?:boolean}){
 const[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[unknown,setUnknown]=useState(false);
 async function submit(accept:boolean){
  if(busy||unknown)return;setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/platform/auth/oauth2/'+(continuation?'continue':'consent'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(continuation?{postLogin:true,oauth_query:query}:{accept,oauth_query:query})});
   if(!response.ok){setUnknown(true);setMessage('连接结果未确认。请返回 ChatGPT 重新发起连接；本页不会重复提交。');return;}
   const value=await response.json();if(value?.redirect!==true||typeof value.url!=='string'||!validOAuthRedirect(value.url,query,config))throw Error('redirect');
   window.location.replace(value.url);
  }catch{setUnknown(true);setMessage('连接结果未确认。请返回 ChatGPT 重新发起连接；本页不会重复提交。');}finally{setBusy(false);}
 }
 return <main data-lifeos-surface="auth" className={s.page}><section className={s.card} aria-labelledby="oauth-title"><h1>LifeOS</h1><h2 id="oauth-title">{continuation?'继续连接':'允许连接你的私人空间'}</h2>
  <p className={s.hint}>客户端：<span style={{overflowWrap:'anywhere'}}>{clientId}</span></p>
  <ul>{scopes.map(scope=><li key={scope}>{scope==='offline_access'?'允许刷新这次连接':(scope.endsWith(':write')?'保存和更新':'读取')+' '+(labels[scope.split(':')[0]]??scope)}</li>)}</ul>
  <p className={s.hint}>连接沿用你已审查的业务授权。普通网页退出不会断开此连接；撤销连接、业务授权或安全重置会停止访问。保存仍需要明确请求。</p>
  {message&&<p className={s.message} role="status">{message}</p>}
  <button type="button" className={s.primary} disabled={busy||unknown} onClick={()=>submit(true)}>{busy?'正在处理…':continuation?'继续':'允许连接'}</button>
  {!continuation&&<button type="button" className={s.alternative} disabled={busy||unknown} onClick={()=>submit(false)}>拒绝</button>}
 </section></main>;
}
