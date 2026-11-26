'use client';
import {useEffect,useState} from 'react';
import {readPersonalSearchDateRange,readPersonalSearchPage} from '../personal-candidate/search-dates.ts';
import {LifeOSWorkspace} from '../ui-review/workspace';
import {loadPersonalSearch,PersonalSearchError} from './client.ts';
import {readSearchSelection} from './model.ts';
import {PersonalSearchView,type SearchViewState} from './view';
export function PersonalSearchPage({query='',type,id,from,to,monthDay,searchPage}:{query?:string;type?:string;id?:string;from?:string|string[];to?:string|string[];monthDay?:string|string[];searchPage?:string|string[]}){
 const[state,setState]=useState<SearchViewState>({phase:'loading'}),[retry,setRetry]=useState(0);
 const range={from:typeof from==='string'?from:undefined,to:typeof to==='string'?to:undefined,monthDay:typeof monthDay==='string'?monthDay:undefined};
 let selection=null,invalid='';
 try{const checked=readPersonalSearchDateRange(from,to,monthDay);readPersonalSearchPage(searchPage,checked.monthDay);}
 catch(error){invalid=error instanceof Error?error.message:'请核对搜索日期。';}
 try{selection=readSearchSelection(type,id);}catch{invalid='原记录链接无效，未读取其他记录。';}
 useEffect(()=>{let generation=0;let controller:AbortController|null=null;let alive=true;
  const hide=()=>{generation++;controller?.abort();setState({phase:'loading'});};
  const load=async()=>{hide();if(invalid){setState({phase:'error',message:invalid});return;}const token=generation;controller=new AbortController();try{const checked=readPersonalSearchDateRange(from,to,monthDay);const data=await loadPersonalSearch(query,readSearchSelection(type,id),controller.signal,fetch,checked,readPersonalSearchPage(searchPage,checked.monthDay));if(alive&&generation===token)setState({phase:'ready',data});}catch(error){if(!alive||generation!==token)return;setState({phase:error instanceof PersonalSearchError&&error.kind==='auth'?'auth':'error',message:error instanceof PersonalSearchError?error.message:'搜索读取失败，请重新读取。'});}};
  const visibility=()=>{if(document.visibilityState==='hidden')hide();else void load();};
  const pageShow=()=>void load();void load();window.addEventListener('pagehide',hide);window.addEventListener('pageshow',pageShow);document.addEventListener('visibilitychange',visibility);
  return()=>{alive=false;generation++;controller?.abort();window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',pageShow);document.removeEventListener('visibilitychange',visibility);};
 },[query,type,id,from,to,monthDay,searchPage,retry,invalid]);
 return <LifeOSWorkspace desktopNavigation state={{status:'unknown'}} access={{authenticated:true,writable:null,loginAllowed:true}} contentPage={{wide:true,title:'搜索本人记录',content:<PersonalSearchView key={JSON.stringify([query,from,to,monthDay])} query={query} range={range} selection={selection} state={state} onRetry={()=>setRetry(value=>value+1)}/>}}/>;
}
