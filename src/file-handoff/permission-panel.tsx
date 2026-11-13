'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '../ui-review/ui/button';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '../ui-review/ui/dialog';
import {filePermissionChangeSchema,type FilePermission,type FilePermissionChange} from './permission-contracts';
import {permissionReadback,readManagedFileGrant} from './permission-client';
import styles from '../personal-candidate/account-api-keys.module.css';
type Grant={id:string;name:string;grantDigest?:string;fileHandoff?:FilePermission};
export function FilePermissionPanel({grant,disabled,onLock,onSaved}:{grant:Grant;disabled:boolean;onLock:(value:boolean)=>void;onSaved:(value:any)=>void}){
 const[open,setOpen]=useState(false),[read,setRead]=useState(false),[write,setWrite]=useState(false),[codex,setCodex]=useState(false),[phase,setPhase]=useState<'editing'|'busy'|'unknown'|'ready'>('editing'),[message,setMessage]=useState('');
 const pending=useRef<FilePermissionChange|null>(null),original=useRef(grant),trigger=useRef<HTMLButtonElement>(null),storageKey='lifeos:file-permission:'+grant.id;
 const locked=phase==='busy'||phase==='unknown';
 useEffect(()=>{
  try{const raw=sessionStorage.getItem(storageKey);if(raw){const value=filePermissionChangeSchema.parse(JSON.parse(raw));if(value.id!==grant.id)throw Error();pending.current=value;setOpen(true);setPhase('unknown');setMessage('上次文件授权结果未确认，请先核对当前状态。');onLock(true);}}catch{setMessage('本地恢复信息不可用，请核对当前文件授权。');}
  return()=>onLock(false);
 },[grant.id,storageKey,onLock]);
 function close(){if(locked)return;setOpen(false);onLock(false);trigger.current?.focus();}
 async function inspect(){
  if(!pending.current)return;setPhase('busy');
  try{const current=await readManagedFileGrant(grant.id),state=permissionReadback(pending.current,current);
   if(state==='unknown'){setPhase('unknown');setMessage('当前还未观察到变更，原请求仍可能完成。请保留原请求并继续核对。');return;}
   sessionStorage.removeItem(storageKey);pending.current=null;onSaved(current);setPhase('ready');setMessage(state==='observed'?'当前文件授权已独立读取并核对。':state==='stopped'?'原密钥已失效，文件权限不可用。':'授权已变化，已读取最新状态；关闭后重新选择。');
  }catch{setPhase('unknown');setMessage('暂时无法核对授权。保留原请求，不会自动再次提交。');}
 }
 async function save(){
  const selected=original.current;if(!selected.grantDigest||locked)return;
  const scopes=read?(write?['file-handoff:read','file-handoff:write']:['file-handoff:read']):[];
  const command=filePermissionChangeSchema.parse({id:grant.id,version:'file-handoff-v1',expectedGrantDigest:selected.grantDigest,expectedFileRevision:selected.fileHandoff?.revision??0,scopes,consumer:read&&codex?'codex':null});
  try{sessionStorage.setItem(storageKey,JSON.stringify(command));}catch{setMessage('浏览器未能保留恢复信息，未更改授权。');return;}
  pending.current=command;setPhase('busy');setMessage('正在保存并核对…');
  const{id:_,...body}=command;
  try{const response=await fetch('/api/platform/account/api-keys/'+encodeURIComponent(grant.id)+'/file-handoff',{method:'PATCH',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
   if([400,401,403,404,409].includes(response.status)){sessionStorage.removeItem(storageKey);pending.current=null;setPhase('ready');setMessage(response.status===409?'授权版本冲突，未覆盖；请关闭后刷新列表再选择。':'文件授权未更改，请核对本人登录与权限。');return;}
   if(!response.ok)throw Error();await inspect();
  }catch{setPhase('unknown');setMessage('文件授权结果未确认。请核对当前状态，不要重新创建或替换密钥。');}
 }
 return <><Button ref={trigger} type="button" variant="outline" disabled={disabled} onClick={()=>{original.current=grant;setRead(grant.fileHandoff?.scopes.includes('file-handoff:read')??false);setWrite(grant.fileHandoff?.scopes.includes('file-handoff:write')??false);setCodex(grant.fileHandoff?.consumer==='codex');setPhase('editing');setMessage('');setOpen(true);onLock(true);}}>文件权限</Button>
  <Dialog open={open} onOpenChange={value=>{if(!value)close();}}><DialogContent className={styles.keyDialog} aria-busy={phase==='busy'} showCloseButton={!locked} onEscapeKeyDown={event=>{if(locked)event.preventDefault();}} onPointerDownOutside={event=>{if(locked)event.preventDefault();}}>
   <DialogTitle>文件交接 · {grant.name}</DialogTitle><DialogDescription>文件权限单独授权，沿用这把密钥的本人空间与到期时间。旧全业务权限不会自动包含文件。</DialogDescription>
   <fieldset className={styles.scopeFields} disabled={phase!=='editing'}><legend>允许这把密钥</legend>
    <label><input type="checkbox" checked={read} onChange={event=>{setRead(event.target.checked);if(!event.target.checked){setWrite(false);setCodex(false);}}}/>读取元数据与下载已交接文件</label>
    <label><input type="checkbox" checked={write} onChange={event=>{setWrite(event.target.checked);if(event.target.checked)setRead(true);}}/>接收明确交给 LifeOS 的文件、记录下载确认</label>
    <label><input type="checkbox" checked={codex} onChange={event=>{setCodex(event.target.checked);if(event.target.checked)setRead(true);}}/>将持有此密钥的已审核领取端授权为 Codex</label>
   </fieldset>
   <p>不包含执行代理、终端、部署、账户管理或自动删除。ChatGPT 仍需独立 OAuth 同意，不能代签网页或 Codex 下载。</p>
   <p role="status" aria-live="polite">{message}</p>
   <div className={styles.actions}>{phase==='editing'&&<Button type="button" onClick={()=>void save()}>确认文件权限</Button>}{phase==='unknown'&&<Button type="button" onClick={()=>void inspect()}>核对原请求状态</Button>}<Button type="button" variant="outline" disabled={locked} onClick={close}>{phase==='ready'?'关闭':'取消'}</Button></div>
  </DialogContent></Dialog>
 </>;
}
