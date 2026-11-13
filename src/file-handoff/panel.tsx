'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {z} from 'zod';
import {Button} from '../ui-review/ui/button';import {Input} from '../ui-review/ui/input';import {Badge} from '../ui-review/ui/badge';
import {useSupportDeparture} from '../ui-review/requirement-support-frame';
import {fileIdSchema,ackFileSchema,type FileEntry} from './public';
import {readWebsiteFile,verifiedFileBytes,websiteAckReceipt} from './web-client';
import styles from './panel.module.css';
const pendingSchema=z.strictObject({input:ackFileSchema,key:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/)});
type Pending=z.infer<typeof pendingSchema>;
export function FileHandoffPanel({initialId=''}:{initialId?:string}){
 const[id,setId]=useState(initialId),[entry,setEntry]=useState<FileEntry|null>(null),[message,setMessage]=useState(''),[fieldError,setFieldError]=useState(''),[phase,setPhase]=useState<'idle'|'busy'|'unknown'>('idle');
 const pending=useRef<Pending|null>(null),storageKey=useRef(''),generation=useRef(0),active=useRef(true),cancel=useRef<AbortController|null>(null);
 const latestId=useRef(id),latestPhase=useRef(phase);latestId.current=id;latestPhase.current=phase;
 useSupportDeparture(false,phase==='busy'||phase==='unknown');
 const load=useCallback(async(fileId:string)=>{
  const epoch=++generation.current;setEntry(null);
  try{
   const response=await fetch('/api/platform/personal/status',{credentials:'same-origin',cache:'no-store',redirect:'error'}),status=await response.json();
   if(!response.ok||status.fileHandoffEnabled!==true||typeof status.ownerId!=='string'||typeof status.spaceId!=='string')throw Error();
   const current=await readWebsiteFile(fileId);if(epoch!==generation.current||!active.current)return;
   storageKey.current='lifeos:file-ack:'+JSON.stringify([status.ownerId,status.spaceId,fileId]);
   const raw=sessionStorage.getItem(storageKey.current);pending.current=raw?pendingSchema.parse(JSON.parse(raw)):null;
   if(pending.current?.input.id!==undefined&&pending.current.input.id!==fileId)throw Error();
   setEntry(current);setPhase(pending.current?'unknown':'idle');setMessage(pending.current?'上次下载确认结果未核对，请恢复原确认。':current.state==='pending'?'原件尚未确认。请在首次交接的工具中保留原参数和命令编号核对，不要另建文件。':'已读取保存的原件与校验信息。');
  }catch{if(epoch===generation.current){setEntry(null);setMessage('文件暂不可读取。请核对本人登录、文件权限与原文件编号。');}}
 },[]);
 useEffect(()=>{
  active.current=true;if(initialId)void load(initialId);
  const hide=()=>{active.current=false;generation.current++;cancel.current?.abort();setEntry(null);setPhase(pending.current?'unknown':'idle');};
  const show=()=>{const wasActive=active.current;active.current=true;if(wasActive&&latestPhase.current==='busy')return;const current=latestId.current;if(fileIdSchema.safeParse(current).success)void load(current);};
  const visible=()=>document.visibilityState==='hidden'?hide():show();
  window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);window.addEventListener('focus',show);document.addEventListener('visibilitychange',visible);
  return()=>{hide();window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);window.removeEventListener('focus',show);document.removeEventListener('visibilitychange',visible);};
 },[initialId,load]);
 function submit(event:FormEvent){event.preventDefault();if(phase!=='idle')return;if(!fileIdSchema.safeParse(id).success){setFieldError('请输入有效的文件编号。');return;}setFieldError('');void load(id);}
 async function confirmOriginal(command:Pending){
  const epoch=generation.current,scopeKey=storageKey.current;setPhase('busy');pending.current=command;
  try{
   const{id:recordId,...body}=command.input;
   const response=await fetch('/api/platform/personal/file-handoffs/'+recordId+'/acknowledgments',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'content-type':'application/json','idempotency-key':command.key},body:JSON.stringify(body)});
   if([400,401,403,404,409].includes(response.status)){if(epoch!==generation.current||!active.current)return;sessionStorage.removeItem(scopeKey);pending.current=null;setPhase('idle');setMessage(response.status===409?'确认版本已变化，未覆盖。请重新读取后校验原件。':'确认未保存，请恢复本人权限后再操作。');return;}
   if(!response.ok)throw Error();const receipt=websiteAckReceipt(await response.json(),command.input),current=await readWebsiteFile(recordId);
   if(current.id!==receipt.id||current.sha256!==receipt.sha256||current.bytes!==receipt.bytes||current.target.sourceId!==receipt.target.sourceId||current.revision<receipt.revision)throw Error();
   if(epoch!==generation.current||!active.current)return;sessionStorage.removeItem(scopeKey);pending.current=null;setEntry(current);setPhase('idle');setMessage('浏览器已取得并校验原件，下载确认已独立读回。磁盘保存与备份需另行确认。');
  }catch{if(active.current&&epoch===generation.current){setPhase('unknown');setMessage('确认结果未核对。保留原确认编号，使用下方按钮恢复；不会重新保存文件。');}}
 }
 async function download(){
  if(!entry||entry.state!=='ready'||phase!=='idle')return;setPhase('busy');setMessage('正在下载并独立校验…');const controller=new AbortController();cancel.current=controller;
  try{
   const response=await fetch('/api/platform/personal/file-handoffs/'+entry.id+'/content',{credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal}),bytes=await verifiedFileBytes(response,entry);
   if(!active.current||controller.signal.aborted)return;
   const current=await readWebsiteFile(entry.id);if(current.sha256!==entry.sha256||current.bytes!==bytes.length||!active.current||controller.signal.aborted)throw Error();
   const url=URL.createObjectURL(new Blob([bytes],{type:entry.mimeType})),link=document.createElement('a');link.href=url;link.download=entry.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   const command={input:{id:entry.id,expectedRevision:current.revision,sha256:entry.sha256!,bytes:bytes.length},key:crypto.randomUUID()};
   sessionStorage.setItem(storageKey.current,JSON.stringify(command));await confirmOriginal(command);
  }catch{if(active.current){setPhase(pending.current?'unknown':'idle');setMessage(pending.current?'确认结果未核对，请恢复原确认。':'下载或校验未完成，未记录确认；原件保留。');}}
  finally{cancel.current=null;}
 }
 return <section className={styles.page} aria-label="文件交接" aria-busy={phase==='busy'}>
  <h1>文件交接</h1><p>读取明确保存到 LifeOS 的原件；网页与 Codex 各自下载、校验并确认。</p>
  <form onSubmit={submit} className={styles.form}><label htmlFor="file-handoff-id">文件编号<Input id="file-handoff-id" value={id} disabled={phase!=='idle'} onChange={event=>setId(event.target.value)} aria-invalid={!!fieldError} aria-describedby="file-handoff-error"/></label><Button type="submit" disabled={phase!=='idle'}>读取文件</Button><p id="file-handoff-error" role="alert">{fieldError}</p></form>
  <p role="status" aria-live="polite">{message}</p>
  {entry&&<article className={styles.card}><div className={styles.heading}><h2>{entry.name}</h2><Badge variant="secondary">{entry.state==='ready'?'原件已接收':'结果未确认'}</Badge></div>
   <dl><div><dt>关联工单</dt><dd><a href={'/personal?page=requirements&requirement='+encodeURIComponent(entry.target.id)}>{entry.target.id}</a></dd></div><div><dt>文件大小</dt><dd>{entry.bytes===null?'尚未确认':entry.bytes+' 字节'}</dd></div><div><dt>SHA-256</dt><dd><code>{entry.sha256??'尚未确认'}</code></dd></div><div><dt>保留</dt><dd>{entry.retention.kind==='temporary'?'临时保留至 '+new Date(entry.retention.retainUntil).toLocaleString('zh-CN'):'保留原件'}</dd></div></dl>
   <p>网页：{entry.acknowledgments.website?'已确认校验':'待独立校验'} · Codex：{entry.acknowledgments.codex?'已确认校验':'待独立校验'}</p>
   <div className={styles.actions}><Button type="button" disabled={phase!=='idle'||entry.state!=='ready'} onClick={()=>void download()}>下载、校验并确认</Button><Button type="button" variant="outline" disabled={phase!=='idle'} onClick={()=>void load(entry.id)}>重新读取</Button></div>
  </article>}
  {phase==='unknown'&&<Button type="button" disabled={!pending.current} onClick={()=>{if(pending.current)void confirmOriginal(pending.current);}}>恢复原下载确认</Button>}
  <p>临时到期不会自动删除唯一原件。确认表示客户端已取得并校验字节，不代表已完成独立备份。</p>
 </section>;
}
