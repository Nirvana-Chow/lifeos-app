'use client';

import {useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {requirements,selectRequirements,type Requirement,type RequirementFilters} from '../platform/requirements';
import {RequirementsTable,RequirementsBoard,RequirementsGantt,implementationLabels,acceptanceLabels,type RequirementView} from './requirements-views';
import {RequirementDetail} from './requirements-detail';
import {RequirementMutationSession,makeRequirementCommand,readRequirementItem,type RequirementBinding,type RequirementMutationState} from '../requirements-candidate/client';
import {requirementDepartureAllowed} from '../requirements-candidate/navigation';
import type {RequirementFields} from '../requirements-candidate/domain';
import type {RequirementItem,RequirementsSnapshot} from '../requirements-candidate/service';
import styles from './requirements-page.module.css';

const baseline=requirements();
const phases=baseline.roadmap?.phases.toSorted((a,b)=>a.order-b.order)??[];
const idle:RequirementMutationState={phase:'idle',pending:null,saved:null,observed:null,error:''};
const noSubscribe=()=>()=>{};
const emptyFields=():RequirementFields=>({title:'',body:'',phaseId:phases[0]?.id??'foundation',priority:'P2',plannedStartOn:null,plannedEndOn:null});
const createPreview=(fields:RequirementFields):Requirement=>({id:'new-requirement',version:1,title:'新增需求',description:fields.body,status:'not_started',delivery:'backlog',sourceRefs:[],acceptanceCriteria:[],evidence:[],blockedBy:[]});
const viewLabels:Record<RequirementView,string>={table:'表格',board:'看板',gantt:'甘特'};

/** The server composes private records; browser storage retains only unresolved commands. */
export function RequirementsPage({container,navigationGuard}:{container?:HTMLElement|null;navigationGuard?:{current:(()=>boolean)|null}}={}){
 const [filters,setFilters]=useState<RequirementFilters>({});
 const [view,setView]=useState<RequirementView>('table');
 const [selected,setSelected]=useState<Requirement|null>(null);
 const [expanded,setExpanded]=useState(false);
 const [pool,setPool]=useState<RequirementsSnapshot|null>(null),[binding,setBinding]=useState<RequirementBinding|null>(null),[writable,setWritable]=useState(false),[availability,setAvailability]=useState('正在读取需求…'),[denied,setDenied]=useState(false);
 const [session,setSession]=useState<RequirementMutationSession|null>(null),[editorItem,setEditorItem]=useState<RequirementItem|null>(null),[creating,setCreating]=useState(false),[detailLoading,setDetailLoading]=useState(false);
 const mutation=useSyncExternalStore(session?.subscribe??noSubscribe,session?.getSnapshot??(()=>idle),()=>idle);
 const opener=useRef<HTMLButtonElement|null>(null),viewButton=useRef<HTMLButtonElement|null>(null),dirty=useRef(false),currentPhase=useRef(mutation.phase),activeBinding=useRef<RequirementBinding|null>(null),sessionRef=useRef<RequirementMutationSession|null>(null),generation=useRef(0),detailGeneration=useRef(0);
 currentPhase.current=mutation.phase;
 const mayDepart=useCallback(()=>requirementDepartureAllowed({dirty:dirty.current,phase:currentPhase.current},()=>window.confirm('需求内容尚未保存，确定放弃这些修改并离开？'),()=>window.alert('需求保存结果尚未确认，请先恢复原请求并读取结果。')),[]);
 const closePrivate=useCallback((deny:boolean,message:string)=>{detailGeneration.current++;activeBinding.current=null;sessionRef.current?.invalidateBinding();setSession(null);setBinding(null);setPool(null);setSelected(null);setEditorItem(null);setCreating(false);setDetailLoading(false);dirty.current=false;setDenied(deny);setWritable(false);setAvailability(message);},[]);
 const reload=useCallback(async()=>{
  const epoch=++generation.current;
  try{
   const status=await fetch('/api/platform/personal/status',{credentials:'same-origin',cache:'no-store'}),value=await status.json();
   if(epoch!==generation.current)return;
   if(status.status===401||status.status===403){closePrivate(true,'当前账号不能读取本人需求，请恢复本人登录。');return;}
   if(status.status!==200||typeof value.ownerId!=='string'||typeof value.spaceId!=='string')throw Error();
   if(value.requirementsEnabled!==true){closePrivate(false,'当前仅可查看公开需求。');return;}
   const result=await fetch('/api/platform/personal/requirements/snapshot',{credentials:'same-origin',cache:'no-store'}),snapshot:RequirementsSnapshot=await result.json();
   if(epoch!==generation.current)return;
   if(result.status===401||result.status===403){closePrivate(true,'当前账号不能读取本人需求，请恢复本人登录。');return;}
   if(result.status!==200||snapshot.scope!=='full-current-requirements-snapshot'||snapshot.truncated!==false||snapshot.total!==snapshot.items?.length||!snapshot.baseline?.requirements||new Set(snapshot.items.map(item=>item.id)).size!==snapshot.items.length)throw Error();
   snapshot.items.forEach(readRequirementItem);
   const next={ownerId:value.ownerId,spaceId:value.spaceId};
   if(activeBinding.current?.ownerId!==next.ownerId||activeBinding.current?.spaceId!==next.spaceId){
    sessionRef.current?.invalidateBinding();activeBinding.current=next;
    const storage={getItem:(key:string)=>window.localStorage.getItem(key),setItem:(key:string,text:string)=>window.localStorage.setItem(key,text),removeItem:(key:string)=>window.localStorage.removeItem(key)};
    const writer=new RequirementMutationSession({binding:next,storage,assertBinding:()=>activeBinding.current?.ownerId===next.ownerId&&activeBinding.current?.spaceId===next.spaceId});sessionRef.current=writer;setSession(writer);
   }
   setBinding(next);setPool(snapshot);setDenied(false);setWritable(value.writable===true);setAvailability(value.writable===true?'':'当前仅可查看需求。');
  }catch{if(epoch===generation.current){setWritable(false);setAvailability('需求读取暂不可用，当前内容尚未刷新。');}}
 },[closePrivate]);
 useEffect(()=>{void reload();const focus=()=>{void reload();};window.addEventListener('focus',focus);return()=>{generation.current++;detailGeneration.current++;activeBinding.current=null;sessionRef.current?.invalidateBinding();window.removeEventListener('focus',focus);};},[reload]);
 useEffect(()=>{if(!navigationGuard)return;navigationGuard.current=mayDepart;return()=>{if(navigationGuard.current===mayDepart)navigationGuard.current=null;};},[navigationGuard,mayDepart]);
 useEffect(()=>{const unload=(event:BeforeUnloadEvent)=>{if(dirty.current||currentPhase.current==='saving'||currentPhase.current==='uncertain'){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',unload);return()=>window.removeEventListener('beforeunload',unload);},[]);
 useEffect(()=>{if(mutation.phase!=='saved'||!mutation.observed)return;const entry=mutation.observed;dirty.current=false;setCreating(false);setEditorItem(entry);setSelected(entry.requirement);setPool(previous=>previous?{...previous,items:previous.items.some(item=>item.id===entry.id)?previous.items.map(item=>item.id===entry.id?entry:item):[...previous.items,entry],total:previous.total+(previous.items.some(item=>item.id===entry.id)?0:1)}:previous);},[mutation.phase,mutation.observed]);
 const displayed=pool?.baseline??baseline,visible=useMemo(()=>({...displayed,requirements:denied?[]:pool?pool.items.map(item=>item.requirement):baseline.requirements}),[displayed,pool,denied]);
 const rows=useMemo(()=>selectRequirements(visible,filters),[visible,filters]);
 const open=useCallback((item:Requirement,trigger:HTMLButtonElement)=>{
  if(!mayDepart())return;dirty.current=false;opener.current=trigger;setExpanded(false);setSelected(item);setCreating(false);setEditorItem(null);
  if(!activeBinding.current)return;const epoch=++detailGeneration.current;setDetailLoading(true);
  void fetch('/api/platform/personal/requirements/'+item.id,{credentials:'same-origin',cache:'no-store'}).then(async response=>{const value=await response.json();if(epoch!==detailGeneration.current)return;if(response.status===401||response.status===403){closePrivate(true,'当前账号不能读取本人需求，请恢复本人登录。');return;}if(response.status!==200)throw Error();const entry=readRequirementItem(value.entry);setEditorItem(entry);setSelected(entry.requirement);}).catch(()=>{if(epoch===detailGeneration.current)setAvailability('需求详情读取失败，请刷新后重试。');}).finally(()=>{if(epoch===detailGeneration.current)setDetailLoading(false);});
 },[mayDepart,closePrivate]);
 const newRequirement=(trigger:HTMLButtonElement)=>{if(!mayDepart())return;detailGeneration.current++;setDetailLoading(false);dirty.current=false;opener.current=trigger;setExpanded(false);setCreating(true);setEditorItem(null);setSelected(createPreview(emptyFields()));};
 const recover=()=>{const pending=mutation.pending;if(!pending)return;dirty.current=false;setCreating(pending.id===null);setEditorItem(pool?.items.find(item=>item.id===pending.id)??null);setSelected(pool?.items.find(item=>item.id===pending.id)?.requirement??createPreview(pending.body.fields));setExpanded(false);};
 const save=async(fields:RequirementFields)=>{if(!binding||!session||!writable||!creating&&!editorItem)return;try{await session.submit(makeRequirementCommand(binding,creating?null:editorItem!.id,fields,crypto.randomUUID(),editorItem?.revision,editorItem?.baselineBinding));}catch{setAvailability('请核对需求完整字段与计划日期。');}};
 const planning=useMemo(()=>new Map(pool?.items.map(item=>[item.id,item.fields])??[]),[pool]);
 const route=displayed.roadmap,current=phases.find(phase=>phase.id===route?.currentPhaseId);
 const setFilter=(name:keyof RequirementFilters,value:string)=>setFilters(previous=>({...previous,[name]:value}));
 return <section className={styles.page} aria-label="需求池" data-requirements-page>
  <div className={styles.frame}>
  <header className={styles.intro}><p>{route?.goal??displayed.scopeNote}</p><div className={styles.route}><span>当前阶段：<strong>{current?.title??'待明确'}</strong></span><span className={styles.routeNext}>下一步：{phases.find(phase=>phase.order>(current?.order??-1))?.title??'逐项验证'}</span><span>稍后：{phases.filter(phase=>phase.order>(current?.order??-1)).slice(1).map(phase=>phase.title).join(' · ')||'持续验收'}</span></div></header>
  <div className={styles.controls}>
   <div className={styles.filters} role="search" aria-label="筛选需求">
    <label htmlFor="requirements-search">搜索需求<input id="requirements-search" type="search" placeholder="标题、编号或来源" value={filters.query??''} onChange={event=>setFilter('query',event.target.value)}/></label>
    <details className={styles.extraFilters} data-requirements-filters><summary>更多筛选</summary><div className={styles.extraFilterFields}><div className={styles.filterField}><label htmlFor="requirements-phase">阶段</label><select id="requirements-phase" value={filters.phase??'all'} onChange={event=>setFilter('phase',event.target.value)}><option value="all">全部阶段</option>{phases.map(phase=><option key={phase.id} value={phase.id}>{phase.title}</option>)}</select></div>
    <div className={styles.filterField}><label htmlFor="requirements-priority">优先级</label><select id="requirements-priority" value={filters.priority??'all'} onChange={event=>setFilter('priority',event.target.value)}><option value="all">全部优先级</option>{['P0','P1','P2','P3'].map(priority=><option key={priority}>{priority}</option>)}</select></div>
    <div className={styles.filterField}><label htmlFor="requirements-implementation">实现状态</label><select id="requirements-implementation" value={filters.implementation??'all'} onChange={event=>setFilter('implementation',event.target.value)}><option value="all">全部实现状态</option>{Object.entries(implementationLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
    <div className={styles.filterField}><label htmlFor="requirements-acceptance">验收状态</label><select id="requirements-acceptance" value={filters.acceptance??'all'} onChange={event=>setFilter('acceptance',event.target.value)}><option value="all">全部验收状态</option>{Object.entries(acceptanceLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
    </div></details>
   </div>
   <div className={styles.viewBar}><div className={styles.viewSwitch} role="group" aria-label="需求视图">{Object.entries(viewLabels).map(([key,label])=><button key={key} ref={view===key?viewButton:undefined} type="button" aria-pressed={view===key} aria-label={`${label}视图`} onClick={()=>setView(key as RequirementView)}>{label}</button>)}</div><p role="status" aria-live="polite">{rows.length} / {visible.requirements.length} 项</p><button type="button" className={styles.actionButton} onClick={()=>{void reload();}}>刷新需求</button><button type="button" className={styles.actionButton} disabled={!writable||mutation.phase==='saving'||mutation.phase==='uncertain'} onClick={event=>newRequirement(event.currentTarget)}>新增需求</button></div>
  </div>
  {availability||mutation.error?<p className={styles.notice} role="status">{mutation.error||availability}</p>:null}
  {mutation.phase==='uncertain'?<div className={styles.recovery} role="status"><span>有未确认的需求保存，请保留原请求。</span><button type="button" onClick={recover} disabled={!mutation.pending}>查看原请求</button><button type="button" disabled={!mutation.pending||!writable} onClick={()=>{void session?.retry();}}>重试原请求并回读</button></div>:null}
  <div className={styles.view}>{view==='table'?<RequirementsTable rows={rows} phases={phases} onOpen={open}/>:view==='board'?<RequirementsBoard rows={rows} phases={phases} onOpen={open}/>:<RequirementsGantt rows={rows} phases={phases} planning={planning} onOpen={open} onShowTable={()=>setView('table')}/>}</div>
  </div>
  <RequirementDetail editor={selected&&(creating||editorItem)?{editorId:creating?'new':editorItem!.id+':'+editorItem!.revision,fields:mutation.phase==='uncertain'&&mutation.pending?mutation.pending.body.fields:creating?emptyFields():editorItem!.fields,phases,writable,busy:mutation.phase==='saving',unknown:mutation.phase==='uncertain',error:mutation.error,conflict:editorItem?.baselineConflict??false,onSave:save,onDirty:value=>{dirty.current=value;},onRetry:()=>{void session?.retry();},onRefresh:()=>{if(selected&&opener.current)open(selected,opener.current);}}:undefined} loading={detailLoading} container={container} item={selected} phaseTitle={phases.find(phase=>phase.id===selected?.roadmap?.phaseId)?.title??'未排阶段'} expanded={expanded} onExpandedChange={()=>setExpanded(value=>!value)} onClose={()=>{if(currentPhase.current==='saving')session?.cancel();if(currentPhase.current!=='uncertain'&&currentPhase.current!=='saving'&&!mayDepart())return;detailGeneration.current++;dirty.current=false;setCreating(false);setSelected(null);setEditorItem(null);}} returnFocus={()=>{(opener.current?.isConnected?opener.current:viewButton.current)?.focus();}}/>
 </section>;
}
