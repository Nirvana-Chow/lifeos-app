'use client';
import {useEffect,useRef,useState} from 'react';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from './ui/dialog';
import {Button} from './ui/button';
import {supportJSON,useSupportOwner} from './requirement-support-hooks';
import {makeSupportCommand} from '../requirement-support-candidate/client';
import {readReleaseNotice,type ReleaseNotice} from './owner-modules';
import styles from './owner-release-notice.module.css';
/** The server's current image/source and source-scoped readback own dismissal. */
export function OwnerReleaseNotice({scope,blocked,container}:{scope:string;blocked:boolean;container:HTMLElement|null}){
 const {owner,session,mutation,refresh}=useSupportOwner(),[notice,setNotice]=useState<ReleaseNotice|null>(null),[open,setOpen]=useState(false),[expanded,setExpanded]=useState(false),[error,setError]=useState('');
 const dismissed=useRef<string|null>(null),returnFocus=useRef<HTMLElement|null>(null);
 const bound=!!owner&&JSON.stringify([owner.ownerId,owner.spaceId])===scope&&owner.writable&&owner.requirementsEnabled&&owner.requirementSupportEnabled;
 useEffect(()=>{let alive=true;setNotice(null);if(!bound)return;void supportJSON('requirement-support/releases').then(value=>{if(alive)setNotice(readReleaseNotice(value));}).catch(()=>{/* No actual source/read state, no automatic announcement. */});return()=>{alive=false;};},[owner,bound]);
 useEffect(()=>{if(!bound||!notice||blocked||dismissed.current===scope+notice.sourceSha)return;
  const restoring=mutation.phase==='uncertain'&&mutation.pending?.kind==='read'&&mutation.pending.body.sourceSha===notice.sourceSha;
  if(mutation.phase==='saving'||mutation.phase==='uncertain'&&!restoring||document.querySelector('[role="dialog"]')||document.activeElement?.matches('input,textarea,select,[contenteditable="true"]'))return;
  returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setOpen(true);
 },[bound,notice,blocked,scope,mutation.phase,mutation.pending]);
 useEffect(()=>{const observed=mutation.observed;if(mutation.phase==='saved'&&notice&&observed&&'sourceSha'in observed&&observed.sourceSha===notice.sourceSha&&observed.seen===true){dismissed.current=scope+notice.sourceSha;setOpen(false);}},[mutation.phase,mutation.observed,notice,scope]);
 const pending=mutation.phase==='saving'||mutation.phase==='uncertain';
 const close=()=>{if(!bound||!owner||!notice||!session||pending)return;setError('');try{void session.submit(makeSupportCommand(owner,'read',null,{sourceSha:notice.sourceSha},crypto.randomUUID()));}catch{setError('更新提醒尚未关闭，请重试。');}};
 return <>{bound&&mutation.phase==='uncertain'&&!open&&<section role="status" className={styles.recovery}><p>上次保存尚未完成，可以继续。</p><Button disabled={!mutation.pending} onClick={()=>void session?.retry()}>继续上次保存</Button><a href="/personal/requirements/updates">查看更新记录</a></section>}<Dialog open={open&&bound&&!!notice&&!blocked} onOpenChange={next=>{if(!next)close();}}><DialogContent container={container} className={styles.dialog} onCloseAutoFocus={event=>{event.preventDefault();if(returnFocus.current?.isConnected)returnFocus.current.focus();}} onEscapeKeyDown={event=>{if(pending)event.preventDefault();}} onPointerDownOutside={event=>event.preventDefault()}><DialogTitle>LifeOS 已更新</DialogTitle><DialogDescription>查看本次改进，或稍后前往更新记录。</DialogDescription>{notice&&<>{expanded&&(notice.records.length?<div className={styles.details}>{notice.records.map(record=><section key={record.id}><h3>{record.title}</h3><ul>{record.changes.map((change,index)=><li key={index}>{change}</li>)}</ul></section>)}</div>:<p>此运行版本尚无逐条更新摘要，可查看完整更新记录。</p>)}{expanded&&<p className={styles.muted}>版本标识 {notice.sourceSha.slice(0,12)}</p>}<div className={styles.actions}><Button variant="outline" disabled={pending} onClick={()=>setExpanded(!expanded)}>{expanded?'收起本次':'查看本次'}</Button><Button variant="outline" asChild><a href="/personal/requirements/updates" aria-disabled={pending||undefined} onClick={event=>{if(pending)event.preventDefault();}}>查看更多</a></Button><Button disabled={pending} onClick={close}>关闭</Button></div>{mutation.phase==='saving'&&<p role="status">正在保存…</p>}{mutation.phase==='uncertain'&&<div role="alert"><p>上次关闭暂未完成，请重试。</p><Button disabled={!bound||!mutation.pending} onClick={()=>void session?.retry()}>继续上次保存</Button></div>}{mutation.phase==='rejected'&&<Button variant="outline" onClick={()=>void refresh()}>刷新更新记录</Button>}{(mutation.error||error)&&<p role="alert">{mutation.error||error}</p>}</>}</DialogContent></Dialog></>;
}
