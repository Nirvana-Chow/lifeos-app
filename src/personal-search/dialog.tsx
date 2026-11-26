'use client';
import {useEffect,useId,useRef,useState,type ComponentPropsWithRef} from 'react';
import {useOwnerPageVerification} from '../personal-candidate/privacy';
import {readPersonalSearchDateRange} from '../personal-candidate/search-dates.ts';
import {Dialog,DialogContent,DialogDescription,DialogTitle,DialogTrigger} from '../ui-review/ui/dialog';
import {loadPersonalSearch,loadPersonalSearchOriginal,PersonalSearchError,verifyPersonalSearchBinding,type PersonalSearchData} from './client.ts';
import {searchHref,type SearchRow} from './model.ts';
import {PersonalSearchView,type SearchDraft,type SearchViewState} from './view';
import s from './styles.module.css';

const emptyDraft:SearchDraft={query:'',range:{}};

type SearchContext={criteria:SearchDraft;selected:SearchRow|null;page:number};
function SearchDialogBody({href,draft,onChange}:{href:string;draft:SearchDraft;onChange:(draft:SearchDraft)=>void}){
 const prefix=useId(),content=useRef<HTMLDivElement>(null);
 const request=useRef<AbortController|null>(null);
 const retry=useRef<(()=>void)|null>(null);
 const resultFocus=useRef<string|null>(null);
 const [context,setContext]=useState<SearchContext>({criteria:emptyDraft,selected:null,page:1});
 const [state,setState]=useState<SearchViewState>({phase:'idle'});
 useEffect(()=>()=>request.current?.abort(),[]);
 useEffect(()=>{
  if(state.phase!=='ready')return;
  if(context.selected){
   content.current?.querySelector<HTMLElement>('section[aria-label="原业务记录只读详情"] h2')?.focus();
  }else if(resultFocus.current){
   const row=resultFocus.current;
   resultFocus.current=null;
   content.current?.querySelector<HTMLButtonElement>('[data-search-result="'+row+'"] button')?.focus();
  }
 },[context.selected,state]);

 function read(next:SearchContext,load:(signal:AbortSignal)=>Promise<PersonalSearchData>){
  const run=async()=>{
   request.current?.abort();
   const controller=new AbortController();
   request.current=controller;
   setContext(next);
   setState({phase:'loading'});
   const deadline=setTimeout(()=>{
    if(controller.signal.aborted)return;
    controller.abort();
    setState({phase:'error',message:'搜索读取超时，请重新读取。'});
   },10_000);
   const clearDeadline=()=>clearTimeout(deadline);
   controller.signal.addEventListener('abort',clearDeadline,{once:true});
   try{
    const data=await load(controller.signal);
    if(!controller.signal.aborted)setState({phase:'ready',data});
   }catch(error){
    if(!controller.signal.aborted){
     setState({phase:error instanceof PersonalSearchError&&error.kind==='auth'?'auth':'error',message:error instanceof PersonalSearchError?error.message:'搜索读取失败，请重新读取。'});
    }
   }finally{
    clearDeadline();
    controller.signal.removeEventListener('abort',clearDeadline);
   }
  };
  retry.current=()=>void run();
  retry.current();
 }
 function submit(criteria:SearchDraft,page=1){
  resultFocus.current=null;
  read({criteria,selected:null,page},signal=>{
   let range;
   try{range=readPersonalSearchDateRange(criteria.range.from,criteria.range.to,criteria.range.monthDay);}
   catch(error){throw new PersonalSearchError('unavailable',error instanceof Error?error.message:'请核对搜索日期。');}
   return loadPersonalSearch(criteria.query,null,signal,fetch,range,page);
  });
 }
 function select(row:SearchRow){
  if(state.phase!=='ready')return;
  const results=state.data;
  resultFocus.current=row.id;
  read({...context,selected:row},signal=>loadPersonalSearchOriginal(results,row,signal));
 }
 function back(){
  if(state.phase!=='ready')return;
  const results=state.data;
  read({...context,selected:null},async signal=>{
   await verifyPersonalSearchBinding(results.binding,signal);
   return {...results,detail:null,detailUnavailable:false};
  });
 }

 const {criteria,selected,page}=context;
 const draftLink=searchHref(draft.query,undefined,draft.range);
 const pageLink=state.phase==='ready'&&selected
  ?searchHref(criteria.query,selected,criteria.range,page)
  :draft.query||draft.range.from||draft.range.to||draft.range.monthDay
   ?draftLink===searchHref(criteria.query,undefined,criteria.range)?searchHref(draft.query,undefined,draft.range,page):draftLink
   :href;
 return <div ref={content}>
  <PersonalSearchView query={criteria.query} range={criteria.range} selection={selected} state={state} onRetry={()=>retry.current?.()}
   interaction={{prefix,standaloneHref:pageLink,draft,onChange,onSubmit:submit,onSelect:select,onBack:back,onPage:page=>submit(criteria,page)}}/>
 </div>;
}

export function PersonalSearchDialogTrigger({href,children,...button}:ComponentPropsWithRef<'button'>&{href:string}){
 const [open,setOpen]=useState(false);
 const [draft,setDraft]=useState<SearchDraft>(emptyDraft);
 const verified=useOwnerPageVerification();
 useEffect(()=>{
  const conceal=()=>{setOpen(false);setDraft(emptyDraft);};
  const visibility=()=>{if(document.visibilityState==='hidden')conceal();};
  window.addEventListener('pagehide',conceal);
  document.addEventListener('visibilitychange',visibility);
  return ()=>{
   window.removeEventListener('pagehide',conceal);
   document.removeEventListener('visibilitychange',visibility);
  };
 },[]);
 useEffect(()=>{
  if(verified===false){setOpen(false);setDraft(emptyDraft);}
 },[verified]);
 const visible=open&&verified!==false;
 return <Dialog open={visible} onOpenChange={setOpen}>
  <DialogTrigger asChild><button {...button} type="button" data-personal-search-focus="">{children}</button></DialogTrigger>
  <DialogContent className={s.dialog} data-personal-search-focus="">
   <div className={s.dialogHeader}>
    <DialogTitle>搜索本人记录</DialogTitle>
    <DialogDescription>搜索当前已授权记录的标题与正文。</DialogDescription>
   </div>
   {visible&&<SearchDialogBody href={href} draft={draft} onChange={setDraft}/>}
  </DialogContent>
 </Dialog>;
}
