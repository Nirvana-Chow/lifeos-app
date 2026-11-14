'use client';
import {useState} from 'react';
import {submitOAuthConsent} from './consent-flow';
import type {BusinessOAuthConfig} from './boundary';
import s from '../personal-candidate/login.module.css';
const labels:Record<string,string>={todo:'待办',organization:'项目、领域与主题',requirements:'需求',journal:'日记',calendar:'日历',health:'健康',person:'联系人',finance:'财务',media:'收藏',career:'职业',portfolio:'作品',cooking:'烹饪',feedback:'反馈','storage-review':'文件审阅','file-handoff':'明确交接的文件'};
export function OAuthPanel({query,clientId,scopes,config,continuation=false}:{query:string;clientId:string;scopes:readonly string[];config:BusinessOAuthConfig;continuation?:boolean}){
 const[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[unknown,setUnknown]=useState(false);
 async function submit(accept:boolean){
  if(busy||unknown)return;setBusy(true);setMessage('');
  try{
   const result=await submitOAuthConsent({query,config,continuation,accept});
   if(result.kind==='unknown'){setUnknown(true);setMessage('连接结果未确认。请返回 ChatGPT 重新发起连接；本页不会重复提交。');return;}
   window.location.replace(result.location);
  }catch{setUnknown(true);setMessage('连接结果未确认。请返回 ChatGPT 重新发起连接；本页不会重复提交。');}finally{setBusy(false);}
 }
 return <main data-lifeos-surface="auth" className={s.page}><section className={s.card} aria-labelledby="oauth-title"><h1>LifeOS</h1><h2 id="oauth-title">{continuation?'继续连接':'允许连接你的私人空间'}</h2>
  <p className={s.hint}>客户端：<span style={{overflowWrap:'anywhere'}}>{clientId}</span></p>
  <ul>{scopes.map(scope=><li key={scope}>{scope==='personal-business:all'?'在已授权范围内读取、保存和更新全部个人业务，包括以后审定并启用的新业务；不包含账号、安全、工程执行或独立文件权限。':scope==='offline_access'?'允许刷新这次连接':(scope.endsWith(':write')?'保存和更新':'读取')+' '+(labels[scope.split(':')[0]]??scope)}</li>)}</ul>
  <p className={s.hint}>连接沿用你已审查的业务授权。普通网页退出不会断开此连接；撤销连接、业务授权或安全重置会停止访问。保存仍需要明确请求。</p>
  {message&&<p className={s.message} role="status">{message}</p>}
  <button type="button" className={s.primary} disabled={busy||unknown} onClick={()=>submit(true)}>{busy?'正在处理…':continuation?'继续':'允许连接'}</button>
  {!continuation&&<button type="button" className={s.alternative} disabled={busy||unknown} onClick={()=>submit(false)}>拒绝</button>}
 </section></main>;
}
