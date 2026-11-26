'use client';

import {useEffect,useRef,useState} from 'react';
import {makePersonalCommand,PersonalMutationSession,type PersonalBinding,type PersonalState} from '../personal-candidate/client';
import {ownerRecord} from '../personal-candidate/record-model';
import {useOwnerPageVerification} from '../personal-candidate/privacy';
import type {PublicEntry} from '../platform/contracts';
import {Button} from '../ui-review/ui/button';
import {Input} from '../ui-review/ui/input';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '../ui-review/ui/dialog';
import {LifeOSWorkspace} from '../ui-review/workspace';
import {articleAttributionLabels,normalizeArticleFields,type ArticleFields,type ArticlePersonal} from './domain';
import s from './workspace.module.css';

type Access=PersonalBinding&{writable:boolean};
type Editor={baseline:PublicEntry|null;fields:ArticleFields;initial:string;needsVersionReview?:true};
type Reading={entry:PublicEntry;history:PublicEntry[];truncated:boolean};

const present=(record:PublicEntry):ArticleFields=>{
  const {draft}=record;
  if(!('text' in draft))throw Error('文章内容无法核对。');
  return normalizeArticleFields({title:draft.title,text:draft.text,occurredOn:draft.occurredOn,personal:draft.personal});
};
const newFields=():ArticleFields=>({
  title:'',text:'',occurredOn:null,
  personal:{type:'article',schemaVersion:1,author:null,attribution:'original',sourceURL:null},
});
const sameScope=(a:PersonalBinding,b:PersonalBinding)=>a.ownerId===b.ownerId&&a.spaceId===b.spaceId;

class ArticleAccessError extends Error {}

async function read<T>(path:string,signal?:AbortSignal):Promise<T>{
  const response=await fetch('/api/platform/personal/'+path,{credentials:'same-origin',cache:'no-store',signal});
  if(response.status===401||response.status===403)throw new ArticleAccessError('本人会话已失效。');
  if(!response.ok)throw Error('暂时无法读取文章，请重试。');
  return response.json() as Promise<T>;
}
async function checkAccess(signal?:AbortSignal):Promise<Access>{
  const value=await read<{scope?:string;ownerId?:string;spaceId?:string;articleEnabled?:boolean;storageVerified?:boolean;writable?:boolean}>('status',signal);
  if(value.scope!=='personal-manual-candidate'||typeof value.ownerId!=='string'||typeof value.spaceId!=='string'||!value.storageVerified)throw Error('本人空间尚未核对。');
  if(value.articleEnabled!==true)throw new ArticleAccessError('文章模块尚未开放。');
  return {ownerId:value.ownerId,spaceId:value.spaceId,writable:value.writable===true};
}
function errorText(error:unknown){
  return error instanceof Error?error.message:'操作未完成，请重试。';
}

function ArticleReader({reading,canEdit,onEdit}:{reading:Reading;canEdit:boolean;onEdit:()=>void}){
  const [selected,setSelected]=useState<number|null>(null);
  const item=reading.history.find(version=>version.revision===selected)??reading.entry;
  const article=present(item);
  return <article className={s.reader} aria-label={article.title}>
    <header className={s.heading}>
      <h2>{article.title}</h2>
      {canEdit&&<Button type="button" variant="outline" onClick={onEdit}>编辑文章</Button>}
    </header>
    <div className={s.meta}>
      {article.personal.author&&<span>{article.personal.author}</span>}
      <span>{articleAttributionLabels[article.personal.attribution]}</span>
      {article.occurredOn&&<time dateTime={article.occurredOn}>{article.occurredOn}</time>}
      {article.personal.sourceURL&&<a href={article.personal.sourceURL} target="_blank" rel="noopener noreferrer">打开原文</a>}
    </div>
    <div className={s.prose}>{article.text}</div>
    {reading.history.length>0&&<details className={s.history}>
      <summary>版本历史</summary>
      <ul>{reading.history.map(row=><li key={row.revision}>
        <Button type="button" variant="ghost" aria-pressed={item.revision===row.revision} onClick={()=>setSelected(row.revision)}>版本 {row.revision}</Button>
      </li>)}</ul>
      {reading.truncated&&<p>这里只显示最近的版本。</p>}
    </details>}
  </article>;
}

export function ArticleWorkspace(){
  const verified=useOwnerPageVerification();
  const binding=useRef<Access|null>(null);
  const session=useRef<PersonalMutationSession|null>(null);
  const draftCache=useRef<{owner:PersonalBinding;editor:Editor}|null>(null);
  const request=useRef<AbortController|null>(null);
  const submitting=useRef(false);
  const dialogRoot=useRef<HTMLDivElement>(null);
  const [access,setAccess]=useState<Access|null>(null);
  const [items,setItems]=useState<PublicEntry[]>([]);
  const [reading,setReading]=useState<Reading|null>(null);
  const [editor,setEditor]=useState<Editor|null>(null);
  const [latest,setLatest]=useState<PublicEntry|null>(null);
  const editorRef=useRef(editor);
  editorRef.current=editor;
  const [mutation,setMutation]=useState<PersonalState|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [retryLoad,setRetryLoad]=useState(0);
  const blocked=busy||mutation?.phase==='saving'||mutation?.phase==='uncertain';
  const dirty=!!editor&&JSON.stringify(editor.fields)!==editor.initial;

  useEffect(()=>{
    if(verified!==true)return;
    let unsubscribe:(()=>void)|undefined;
    const controller=new AbortController();
    setLoading(true);
    setError('');
    void (async()=>{
      try{
        const before=await checkAccess(controller.signal);
        const index=await read<{items:unknown[];total:number;truncated:boolean}>('article/snapshot',controller.signal);
        const after=await checkAccess(controller.signal);
        if(!sameScope(before,after)||index.truncated!==false||index.total!==index.items.length)throw Error('无法核对文章列表。');
        if(controller.signal.aborted)return;
        const entries=index.items.map(item=>ownerRecord(item,'article',after.spaceId));
        const active=new PersonalMutationSession({
          binding:{ownerId:after.ownerId,spaceId:after.spaceId},storage:window.localStorage,verifyReadback:true,
          assertBinding:()=>binding.current!==null&&sameScope(binding.current,after),
          onAuthorizationLost:()=>conceal('本人会话或写入权限已变化，请重新核对。'),
        });
        binding.current=after;
        session.current=active;
        unsubscribe=active.subscribe(()=>setMutation(active.getSnapshot()));
        setMutation(active.getSnapshot());
        setAccess(after);
        setItems(entries);
        const cached=draftCache.current;
        draftCache.current=null;
        if(cached&&sameScope(cached.owner,after))setEditor(cached.editor);
      }catch(error){if(!controller.signal.aborted)setError(errorText(error));}
      finally{if(!controller.signal.aborted)setLoading(false);}
    })();
    return()=>{
      controller.abort();
      request.current?.abort();
      if(binding.current&&editorRef.current)draftCache.current={owner:binding.current,editor:editorRef.current};
      binding.current=null;
      unsubscribe?.();
      session.current?.invalidateBinding();
      session.current=null;
      setAccess(null);setItems([]);setReading(null);setEditor(null);setLatest(null);setMutation(null);setBusy(false);setNotice('');
    };
  },[verified,retryLoad]);

  useEffect(()=>{
    const warn=(event:BeforeUnloadEvent)=>{
      if(dirty||submitting.current||session.current?.getSnapshot().phase==='uncertain'){event.preventDefault();event.returnValue='';}
    };
    window.addEventListener('beforeunload',warn);
    return()=>window.removeEventListener('beforeunload',warn);
  },[dirty]);

  function conceal(message:string){
    if(binding.current&&editorRef.current)draftCache.current={owner:binding.current,editor:editorRef.current};
    binding.current=null;
    request.current?.abort();
    session.current?.invalidateBinding();
    session.current=null;
    setAccess(null);setItems([]);setReading(null);setEditor(null);setLatest(null);setMutation(null);setBusy(false);setNotice('');
    setError(message);
  }
  function mayLeave(){
    return !submitting.current&&(!dirty||window.confirm('放弃尚未保存的修改？'));
  }
  function edit(baseline:PublicEntry|null){
    const fields=baseline?present(baseline):newFields();
    session.current?.cancel();
    setError('');
    setNotice('');
    setLatest(null);
    setEditor({baseline,fields,initial:JSON.stringify(fields)});
  }
  async function open(id:string){
    const owner=binding.current;
    if(!owner)return;
    request.current?.abort();
    const controller=new AbortController();
    request.current=controller;
    setError('');
    try{
      const [current,versions]=await Promise.all([
        read<{entry:unknown}>('article/'+id,controller.signal),
        read<{items:unknown[];truncated:boolean}>('article/'+id+'/history',controller.signal),
      ]);
      const after=await checkAccess(controller.signal);
      if(controller.signal.aborted||!binding.current)return;
      if(!sameScope(owner,after)||!sameScope(binding.current,after))throw new ArticleAccessError('本人空间已变化。');
      const entry=ownerRecord(current.entry,'article',after.spaceId);
      const history=versions.items.map(row=>ownerRecord(row,'article',after.spaceId));
      if(entry.id!==id||history[0]?.revision!==entry.revision||history.some(row=>row.id!==id||row.source.id!==entry.source.id))throw Error('文章版本已更新，请重新打开。');
      setReading({entry,history,truncated:versions.truncated===true});
    }catch(error){
      if(!controller.signal.aborted){
        if(error instanceof ArticleAccessError)conceal(error.message);
        else setError(errorText(error));
      }
    }
  }
  async function readLatest(){
    const owner=binding.current, baseline=editor?.baseline;
    if(!owner||!baseline||!editor.needsVersionReview||submitting.current)return;
    request.current?.abort();
    const controller=new AbortController();
    request.current=controller;
    submitting.current=true;
    setBusy(true);
    setError('');
    setLatest(null);
    try{
      const {entry}=await read<{entry:unknown}>('article/'+baseline.id,controller.signal);
      const after=await checkAccess(controller.signal);
      if(controller.signal.aborted||!binding.current)return;
      if(!sameScope(owner,after)||!sameScope(binding.current,after))throw new ArticleAccessError('本人空间已变化。');
      const current=ownerRecord(entry,'article',after.spaceId);
      if(current.id!==baseline.id||current.source.id!==baseline.source.id||current.revision<=baseline.revision)
        throw Error('无法核对文章的更新版本。');
      setLatest(current);
    }catch(error){
      if(!controller.signal.aborted){
        if(error instanceof ArticleAccessError)conceal(error.message);
        else setError(errorText(error));
      }
    }finally{
      submitting.current=false;
      if(!controller.signal.aborted)setBusy(false);
    }
  }

  function confirmVersion(){
    if(!latest||!editor?.needsVersionReview||blocked||!access?.writable)return;
    const {needsVersionReview:_,...draft}=editor;
    setEditor({...draft,baseline:latest});
    session.current?.cancel();
    setLatest(null);
    setError('');
  }

  async function save(retry=false){
    const active=session.current, owner=binding.current;
    if(!active||!owner?.writable||submitting.current||(!retry&&(!editor||editor.needsVersionReview)))return;
    submitting.current=true;
    setBusy(true);
    setError('');
    setNotice('');
    try{
      const after=await checkAccess();
      if(session.current!==active)return;
      if(!sameScope(owner,after)||!after.writable)throw new ArticleAccessError('本人会话或写入权限已变化。');
      if(retry){
        if(active.getSnapshot().pending?.type!=='article')return;
        await active.retry(true);
      }else if(editor){
        const command=makePersonalCommand({ownerId:owner.ownerId,spaceId:owner.spaceId},'article',editor.baseline?.id??null,editor.fields,crypto.randomUUID(),true,editor.baseline?.revision);
        await active.submit(command,true);
      }
      if(session.current!==active)return;
      const result=active.getSnapshot();
      if(result.phase==='rejected'&&result.articleRevisionConflict){
        setLatest(null);
        setEditor(current=>current?{...current,needsVersionReview:true}:null);
      }
      if(result.phase!=='saved'||!result.saved)return;
      const entry=result.observed??result.saved;
      setItems(current=>[entry,...current.filter(row=>row.id!==entry.id)]);
      setEditor(null);
      setLatest(null);
      setNotice(entry.revision===result.saved.revision?'文章已保存。':'文章已保存，之后有新的修改。');
      await open(entry.id);
    }catch(error){
      if(session.current===active){
        if(error instanceof ArticleAccessError)conceal(error.message);
        else setError(errorText(error));
      }
    }
    finally{submitting.current=false;if(session.current===active)setBusy(false);}
  }

  const canEdit=access?.writable===true&&!blocked;
  const latestFields=latest?present(latest):null;
  const recovery=mutation?.phase==='uncertain'&&mutation.pending?.type==='article'&&access?.writable&&
    <Button type="button" variant="outline" disabled={busy} onClick={()=>void save(true)}>重试原保存请求</Button>;
  const content=<div ref={dialogRoot} className={s.page}>
    <div className={s.heading}><h1>文章</h1><Button type="button" disabled={!canEdit} onClick={()=>edit(null)}>新建文章</Button></div>
    {loading&&<p role="status">正在读取文章…</p>}
    {notice&&<p role="status">{notice}</p>}
    {!editor&&error&&<div className={s.feedback}><p role="alert">{error}</p>{!access&&<Button variant="outline" onClick={()=>setRetryLoad(value=>value+1)}>重新核对</Button>}</div>}
    {!editor&&mutation?.error&&<p role="alert">{mutation.error}</p>}
    {!editor&&recovery}
    {access&&<div className={s.columns}>
      <section className={s.index} aria-label="文章列表">
        {items.length===0&&<p>还没有文章。</p>}
        <ul>{items.map(entry=><li key={entry.id}><Button type="button" variant="ghost" onClick={()=>void open(entry.id)} aria-pressed={reading?.entry.id===entry.id}>{'title' in entry.draft?entry.draft.title:''}</Button></li>)}</ul>
      </section>
      {reading&&<ArticleReader key={reading.entry.id+':'+reading.entry.revision} reading={reading} canEdit={canEdit} onEdit={()=>edit(reading.entry)}/>}
    </div>}
    {editor&&<Dialog open onOpenChange={open=>{if(!open&&!blocked&&mayLeave())setEditor(null);}}>
      <DialogContent className={s.dialog} container={dialogRoot.current} showCloseButton={!blocked}>
        <DialogTitle>{editor.baseline?'编辑文章':'新建文章'}</DialogTitle>
        <DialogDescription>请填写作者或原文链接，方便日后查阅。</DialogDescription>
        <form onSubmit={event=>{event.preventDefault();void save();}}>
          <fieldset disabled={blocked||!access?.writable} className={s.form}>
            <label>标题<Input required maxLength={240} value={editor.fields.title} onChange={event=>setEditor({...editor,fields:{...editor.fields,title:event.target.value}})}/></label>
            <label>正文<textarea aria-label="正文" required rows={8} maxLength={16384} value={editor.fields.text} onChange={event=>setEditor({...editor,fields:{...editor.fields,text:event.target.value}})}/></label>
            <label>作者<Input maxLength={240} value={editor.fields.personal.author??''} onChange={event=>setEditor({...editor,fields:{...editor.fields,personal:{...editor.fields.personal,author:event.target.value||null}}})}/></label>
            <label>原文链接<Input type="url" maxLength={2048} value={editor.fields.personal.sourceURL??''} onChange={event=>setEditor({...editor,fields:{...editor.fields,personal:{...editor.fields.personal,sourceURL:event.target.value||null}}})}/></label>
            <label>内容归属<select value={editor.fields.personal.attribution} onChange={event=>setEditor({...editor,fields:{...editor.fields,personal:{...editor.fields.personal,attribution:event.target.value as ArticlePersonal['attribution']}}})}>
              {Object.entries(articleAttributionLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}
            </select></label>
            <label>文章日期<Input type="date" value={editor.fields.occurredOn??''} onChange={event=>setEditor({...editor,fields:{...editor.fields,occurredOn:event.target.value||null}})}/></label>
            <div className={s.actions}>
              <Button variant="outline" type="button" onClick={()=>{if(mayLeave())setEditor(null);}}>取消</Button>
              <Button type="submit" disabled={editor.needsVersionReview}>保存文章</Button>
            </div>
          </fieldset>
        </form>
        {(error||mutation?.error)&&<p role="alert">{error||mutation?.error}</p>}
        {editor.needsVersionReview&&<div className={s.conflict}>
          <p>草稿已保留。请核对最新版本后继续编辑。</p>
          <div>
            <Button type="button" variant="outline" disabled={blocked} onClick={()=>void readLatest()}>读取最新版本</Button>
          </div>
          {latest&&latestFields&&<section aria-label="最新保存版本" className={s.comparison}>
            <h3>最新保存版本 · {latest.revision}</h3>
            <p>{latestFields.title}</p>
            <div className={s.meta}>
              <span>{articleAttributionLabels[latestFields.personal.attribution]}</span>
              {latestFields.personal.author&&<span>{latestFields.personal.author}</span>}
              {latestFields.occurredOn&&<time dateTime={latestFields.occurredOn}>{latestFields.occurredOn}</time>}
              {latestFields.personal.sourceURL&&<span>{latestFields.personal.sourceURL}</span>}
            </div>
            <div className={s.prose}>{latestFields.text}</div>
            <div>
              <Button type="button" variant="outline" disabled={blocked||!access?.writable} onClick={confirmVersion}>
                确认以版本 {latest.revision} 继续编辑
              </Button>
            </div>
          </section>}
        </div>}
        {recovery}
      </DialogContent>
    </Dialog>}
  </div>;
  return <LifeOSWorkspace desktopNavigation state={{status:'unknown'}} access={{authenticated:true,writable:null,loginAllowed:true}}
    contentPage={{wide:true,title:'文章',content}} onBeforeNavigate={mayLeave}/>;
}
