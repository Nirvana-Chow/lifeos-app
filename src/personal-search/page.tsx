'use client';
import {useEffect,useState} from 'react';
import {LifeOSWorkspace} from '../ui-review/workspace';
import {loadPersonalSearch,PersonalSearchError} from './client.ts';
import {readSearchSelection} from './model.ts';
import {PersonalSearchView,type SearchViewState} from './view';
export function PersonalSearchPage({query='',type,id}:{query?:string;type?:string;id?:string}){
 const[state,setState]=useState<SearchViewState>({phase:'loading'}),[retry,setRetry]=useState(0);
 let selection=null,invalid='';try{selection=readSearchSelection(type,id);}catch{invalid='原记录链接无效，未读取其他记录。';}
 useEffect(()=>{let generation=0;let controller:AbortController|null=null;let alive=true;
  const hide=()=>{generation++;controller?.abort();setState({phase:'loading'});};
  const load=async()=>{hide();if(invalid){setState({phase:'error',message:invalid});return;}const token=generation;controller=new AbortController();try{const data=await loadPersonalSearch(query,readSearchSelection(type,id),controller.signal);if(alive&&generation===token)setState({phase:'ready',data});}catch(error){if(!alive||generation!==token)return;setState({phase:error instanceof PersonalSearchError&&error.kind==='auth'?'auth':'error',message:error instanceof PersonalSearchError?error.message:'搜索读取失败，请重新读取。'});}};
  const visibility=()=>{if(document.visibilityState==='hidden')hide();else void load();};
  const pageShow=()=>void load();void load();window.addEventListener('pagehide',hide);window.addEventListener('pageshow',pageShow);document.addEventListener('visibilitychange',visibility);
  return()=>{alive=false;generation++;controller?.abort();window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',pageShow);document.removeEventListener('visibilitychange',visibility);};
 },[query,type,id,retry,invalid]);
 return <LifeOSWorkspace state={{status:'unknown'}} access={{authenticated:true,writable:null,loginAllowed:true}} contentPage={{wide:true,title:'搜索本人记录',content:<PersonalSearchView key={query} query={query} selection={selection} state={state} onRetry={()=>setRetry(value=>value+1)}/>}}/>;
}
