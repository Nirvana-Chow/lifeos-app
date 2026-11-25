'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {useTable,type ColumnDef} from '@tanstack/react-table';
import {DataGrid,DataGridContainer,dataGridFeatures} from '../ui-review/reui/data-grid';
import {DataGridTableVirtual} from '../ui-review/reui/data-grid-table-virtual';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '../ui-review/ui/dialog';
import {Button} from '../ui-review/ui/button';
import {Input} from '../ui-review/ui/input';
import type {PublicEntry} from '../platform/contracts';
import {normalizePersonalFields,type JournalPersonal,type PersonalReference} from './business';
import {makePersonalCommand,PersonalMutationSession,type PersonalBinding,type PersonalState} from './client';
import {ownerRecord,recordFields,type RecordModule,type RecordFields} from './record-model';
import {RelationFields} from './relation-fields';
import {useOwnerPageVerification} from './privacy';
import {type PersonPersonal} from '../personal-people/model';
import {PersonFields} from '../personal-people/PersonFields';
import {personSummary,projectPeopleEntries} from '../personal-people/projection';
import {projectRelatedJournals,type RelatedJournals} from '../personal-people/journal-links';
import {PeopleOverview} from '../personal-people/PeopleOverview';
import {HealthFields} from '../personal-health/fields';
import type {HealthPersonal,HealthPersonalFields} from '../personal-health/domain';
import {emptyHealthFields,healthSummary,healthKindLabels,healthMetricLabels} from '../personal-health/presentation';
import {HealthEntriesSummary} from '../personal-health/summary';
import {HealthRecordFilters} from '../personal-health/record-filters';
import {matchesHealthRecord,type HealthRecordCategory,type HealthRecordStatus} from '../personal-health/record-filter';
import {projectHealthTrend,type HealthMetric} from '../personal-health/projection';
import {TrainingCalendar} from '../personal-health/xunji-log/calendar';
import {HealthTrendView} from '../personal-health/trend';
import {emptyMediaPersonal,type MediaPersonalFields,type MediaPersonal} from '../personal-media/domain';
import {MediaFields} from '../personal-media/MediaFields';
import {MediaBoard} from '../personal-media/MediaBoard';
import {isNovelTopic,matchesMediaBrowse,mediaBrowseGroups,mediaSummary,type MediaBrowseFilter} from '../personal-media/projection';
import {careerKinds,type CareerPersonalFields,type CareerPersonal} from '../personal-career/domain';
import {CareerFields} from '../personal-career/CareerFields';
import {CareerBoard} from '../personal-career/CareerBoard';
import {CareerMatch} from '../personal-career/CareerMatch';
import {ResumePreview} from '../personal-career/ResumePreview';
import {careerSummary} from '../personal-career/projection';
import {emptyPortfolioPersonal,portfolioKinds,type PortfolioKind,type PortfolioPersonalFields,type PersonalPortfolio} from '../personal-portfolio/model';
import {PortfolioFields} from '../personal-portfolio/fields';
import {PortfolioOverview} from '../personal-portfolio/overview';
import {portfolioSummary,portfolioKindLabels} from '../personal-portfolio/projection';
import {recordModuleLabels as labels,recordModuleDescriptions,emptyRecordFields,recordModuleEnabled,recordStageFields,initialRecordView,type CareerSection,type RecordView} from './record-modules';
import s from './record-workbench.module.css';
const recordLabels={todo:'待办',journal:'日记',project:'项目',domain:'领域',topic:'主题',calendar:'日程',health:'健康',person:'人物',media:'书影音',career:'职业记录',portfolio:'账户资产投资',cooking:'做饭'};
const zone=()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';}catch{return'UTC';}};
const emptyLinks=()=>({project:null,domain:null,topics:[],people:[]});
const fresh=(type:RecordModule,kind?:PortfolioKind)=>emptyRecordFields(type,zone(),kind);
const emptyOptions=():Record<string,PublicEntry[]>=>({project:[],domain:[],topic:[],person:[],career:[],portfolio:[]});
type Status=PersonalBinding&{writable:boolean;storageVerified:true;allowedTypes:string[];healthEnabled:boolean;peopleEnabled:boolean;mediaEnabled:boolean;careerEnabled:boolean;portfolioEnabled:boolean};
const keyOf=(v:PersonalBinding)=>JSON.stringify([v.ownerId,v.spaceId]);
async function json(path:string){const response=await fetch('/api/platform/personal/'+path,{credentials:'same-origin',cache:'no-store'}),value=await response.json();if(!response.ok)throw Error(value?.error?.message||'读取未完成，请重试。');return value;}
function readStatus(v:unknown):Status{const value=v as Status;if(!value||typeof value.ownerId!=='string'||typeof value.spaceId!=='string'||value.storageVerified!==true||!Array.isArray(value.allowedTypes))throw Error('本人空间尚未就绪。');return {...value,writable:value.writable===true};}
export function PersonalRecordWorkbench({type,navigationGuard,linkedPersonId,careerSection,writeJournal,journalDay,onJournalSaved}:{type:RecordModule;linkedPersonId?:string;careerSection?:CareerSection;writeJournal?:boolean;journalDay?:string;onJournalSaved?:()=>void;navigationGuard?:{current:(()=>boolean)|null}}){
 const title=labels[careerSection??type];
 const verified=useOwnerPageVerification(),hasPrivacyBoundary=verified!==null;
 const [healthCategory,setHealthCategory]=useState<HealthRecordCategory>('all');
 const [healthStatus,setHealthStatus]=useState<HealthRecordStatus>('all');
 const [status,setStatus]=useState<Status|null>(null),[entries,setEntries]=useState<PublicEntry[]>([]),[options,setOptions]=useState<Record<string,PublicEntry[]>>(emptyOptions),[search,setSearch]=useState(''),[metric,setMetric]=useState<HealthMetric>('weight'),[view,setView]=useState<RecordView>(()=>initialRecordView(type,careerSection)),[resumeId,setResumeId]=useState('');
 const [relatedJournals,setRelatedJournals]=useState<RelatedJournals|null>(null),[linkedProfile,setLinkedProfile]=useState(linkedPersonId);
 const [mediaKind,setMediaKind]=useState<MediaBrowseFilter>('all');
 const [editor,setEditor]=useState<{entry:PublicEntry|null;fields:RecordFields;initial:string}|null>(null),[history,setHistory]=useState<PublicEntry[]>([]),[mutation,setMutation]=useState<PersonalState|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const draftCache=useRef<{scope:string;editor:NonNullable<typeof editor>;history:PublicEntry[]}|null>(null);
 const root=useRef<HTMLDivElement>(null),session=useRef<PersonalMutationSession|null>(null),current=useRef<Status|null>(null),generation=useRef(0),editorRef=useRef(editor),busyRef=useRef(false);editorRef.current=editor;busyRef.current=busy;
 const currentDraft=()=>editorRef.current??(type==='journal'?draftCache.current?.editor:null);
 const activeDraft=currentDraft();
 const dirty=!!activeDraft&&JSON.stringify(activeDraft.fields)!==activeDraft.initial,blocked=busy||mutation?.phase==='saving'||mutation?.phase==='uncertain';
 function leave(){const draft=currentDraft();return !busyRef.current&&!['saving','uncertain'].includes(session.current?.getSnapshot().phase??'')&&(!draft||JSON.stringify(draft.fields)===draft.initial||window.confirm('放弃尚未保存的修改？'));}
 useEffect(()=>{if(navigationGuard)navigationGuard.current=leave;return()=>{if(navigationGuard)navigationGuard.current=null;};});
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(dirty||blocked){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty,blocked]);
 async function refresh(){
  const token=++generation.current;
  setBusy(true);setError('');
  try{
   const next=readStatus(await json('status'));
   if(!recordModuleEnabled(type,next))throw Error('此模块尚未开放。');
   const data=await json(type+'/snapshot');
   if(!Array.isArray(data.items)||data.truncated!==false||data.total!==data.items.length)throw Error('完整记录未读取完成。');
   const rows=data.items.map((entry:unknown)=>ownerRecord(entry,type,next.spaceId));
   const references=await json('overview?today='+new Date().toISOString().slice(0,10));
   const after=readStatus(await json('status'));
   if(!recordModuleEnabled(type,after))throw Error('此模块尚未开放。');
   if(token!==generation.current)return;
   const scope=keyOf(after);
   if(keyOf(next)!==scope){
    if(type==='journal'){discardJournalDraft();hide();setError('本人空间已变化，请重新核对。');}
    return;
   }
   if(type==='journal'&&draftCache.current?.scope!==scope)draftCache.current=null;
   if(current.current&&keyOf(current.current)!==scope){
    setEditor(null);setHistory([]);setResumeId('');session.current?.invalidateBinding();session.current=null;
   }
   current.current=after;setStatus(after);setEntries(rows);
   if(type==='person')setRelatedJournals(projectRelatedJournals(references,projectPeopleEntries(rows,after.spaceId),after.spaceId));
   const refs=emptyOptions();
   for(const entry of references.items??[]){
    const kind=entry.draft?.personal?.type;
    if(kind in refs)refs[kind].push(entry);
   }
   if(type==='career'||type==='portfolio')refs[type]=rows;
   setOptions(refs);
   if(!session.current&&draftCache.current?.scope===scope){
    setEditor(draftCache.current.editor);setHistory(draftCache.current.history);draftCache.current=null;
   }
   if(!session.current){
    const binding={ownerId:after.ownerId,spaceId:after.spaceId};
    const nextSession=new PersonalMutationSession({
     binding,storage:localStorage,verifyReadback:true,
     onAuthorizationLost:type==='journal'?recheckJournalAuthorization:undefined,
     assertBinding:()=>!!current.current&&keyOf(current.current)===scope,
    });
    session.current=nextSession;
    nextSession.subscribe(()=>{if(session.current===nextSession)setMutation(nextSession.getSnapshot());});
    setMutation(nextSession.getSnapshot());
   }
  }catch(e){
   if(token!==generation.current)return;
   const retained=draftCache.current;
   hide();
   if(type!=='journal')draftCache.current=retained;
   setError(e instanceof Error?e.message:'读取未完成。');
  }finally{if(token===generation.current)setBusy(false);}
 }
 function recheckJournalAuthorization(){
  hide();
  setError('本人身份或写入权限须重新核对。');
  window.dispatchEvent(new Event('focus'));
 }
 function discardJournalDraft(){draftCache.current=null;editorRef.current=null;setEditor(null);}
 function hide(){
  if(current.current&&editorRef.current)draftCache.current={scope:keyOf(current.current),editor:editorRef.current,history:[]};
  generation.current++;current.current=null;setStatus(null);setEntries([]);setRelatedJournals(null);setResumeId('');setEditor(null);setHistory([]);setOptions(emptyOptions());session.current?.invalidateBinding();session.current=null;setMutation(null);setBusy(false);
 }
 useEffect(()=>{
  setView(initialRecordView(type,careerSection));
  setLinkedProfile(linkedPersonId);
  const visibility=()=>{if(document.visibilityState==='hidden')hide();else if(!hasPrivacyBoundary)void refresh();};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',hide);
  return()=>{hide();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',hide);};
 },[type,hasPrivacyBoundary,linkedPersonId,careerSection]);
 useEffect(()=>{if(verified===false)hide();else void refresh();},[type,verified,linkedPersonId]);
 async function open(entry:PublicEntry){if(!leave()||!current.current)return;const binding=keyOf(current.current),token=generation.current;setBusy(true);setError('');try{const data=await json(type+'/'+entry.id),row=ownerRecord(data.entry,type,current.current.spaceId),versions=await json(type+'/'+entry.id+'/history');const after=readStatus(await json('status'));if(token!==generation.current||!current.current||binding!==keyOf(after)||binding!==keyOf(current.current))return;const fields=recordFields(row,type);setEditor({entry:row,fields,initial:JSON.stringify(fields)});setHistory((versions.items??[]).map((item:unknown)=>ownerRecord(item,type,after.spaceId)));}catch(e){if(token===generation.current)setError(e instanceof Error?e.message:'读取未完成。');}finally{if(token===generation.current)setBusy(false);}}
 async function save(){
  const active=session.current,token=generation.current;
  if(!editor||status?.writable!==true||!active||blocked||verified===false)return;
  setError('');setNotice('');
  try{
   const fields=normalizePersonalFields(type,editor.fields);
   const command=makePersonalCommand({ownerId:status.ownerId,spaceId:status.spaceId},type,editor.entry?.id??null,fields,'record-'+crypto.randomUUID(),true,editor.entry?.revision);
   await active.submit(command,type==='journal');
   if(active!==session.current||token!==generation.current)return;
   const result=active.getSnapshot();
   if(result.phase!=='saved')return;
   discardJournalDraft();
   setNotice(result.observed&&result.saved&&result.observed.revision>result.saved.revision?'本次保存已确认；记录随后有更新，列表显示最新版本。':'已保存');
   if(type==='journal')onJournalSaved?.();
   await refresh();
  }catch(e){setError(e instanceof Error?e.message:'请核对输入。');}
 }
 function create(kind?:PortfolioKind){
  if(blocked||!status?.writable||!leave())return;
  const fields=careerSection==='resume'?emptyRecordFields('career',zone(),'resume'):fresh(type,kind);
  if(type==='journal'&&writeJournal&&journalDay)fields.occurredOn=journalDay;
  if(type==='media'){
   if(mediaKind==='music'||mediaKind==='photography')return;
   if(mediaKind!=='all'){
    const personal=emptyMediaPersonal(mediaKind==='screen'?'film':mediaKind==='reading'||mediaKind==='novel'?'book':mediaKind);
    if(mediaKind==='novel'){
     const topics=options.topic.filter(isNovelTopic);
     if(topics.length===1)personal.links.topics=[{id:topics[0].id,sourceId:topics[0].source.id,revision:topics[0].revision}];
    }
    fields.personal=personal;
   }
  }
  setEditor({entry:null,fields,initial:JSON.stringify(fields)});
  setHistory([]);
  setNotice('');
 }
 async function move(id:string,state:string){
  const active=session.current,bound=current.current,token=generation.current;
  if(!active||!bound||!bound.writable||busyRef.current||editorRef.current||['saving','uncertain'].includes(active.getSnapshot().phase))return;
  busyRef.current=true;setBusy(true);setError('');setNotice('');
  try{const data=await json(type+'/'+id);if(token!==generation.current||active!==session.current||!current.current||keyOf(bound)!==keyOf(current.current))return;
   const entry=ownerRecord(data.entry,type,bound.spaceId),fields=recordStageFields(type,recordFields(entry,type),state);
   await active.submit(makePersonalCommand({ownerId:bound.ownerId,spaceId:bound.spaceId},type,entry.id,fields,'record-'+crypto.randomUUID(),true,entry.revision));
   if(token!==generation.current||active!==session.current)return;
   if(active.getSnapshot().phase==='saved'){setNotice('已更新状态');await refresh();}
  }catch(e){if(token===generation.current)setError(e instanceof Error?e.message:'状态尚未更新，请重试。');}
  finally{if(token===generation.current){busyRef.current=false;setBusy(false);}}
 }
 async function retry(){
  const active=session.current,pending=mutation?.pending,token=generation.current;
  if(!active||!pending||!mayRetry(pending.type))return;
  await active.retry(pending.type==='journal');
  if(active!==session.current||token!==generation.current||active.getSnapshot().phase!=='saved')return;
  discardJournalDraft();setHistory([]);setNotice('上次的'+recordLabels[pending.type]+'已保存');
  if(pending.type==='journal')onJournalSaved?.();
  await refresh();
 }
 function mayRetry(pendingType:PersonalType){
  return status?.writable===true&&verified!==false&&!busy&&(pendingType!=='journal'||status.allowedTypes.includes('journal'));
 }
 const sectionEntries=useMemo(()=>careerSection?entries.filter(entry=>{
  const record=recordFields(entry,'career').personal;
  return record?.type==='career'&&(record.careerKind==='resume')===(careerSection==='resume');
 }):entries,[entries,careerSection]);
 const rows=useMemo(()=>sectionEntries.filter(entry=>JSON.stringify(entry.draft).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())),[sectionEntries,search]);
 const tableRows=useMemo(()=>{
  if(type==='health'&&view==='table'&&healthCategory!=='all'){
   return rows.filter(entry=>matchesHealthRecord(recordFields(entry,'health') as HealthPersonalFields,healthCategory,healthStatus));
  }
  if(type!=='media'||mediaKind==='all')return rows;
  return rows.filter(entry=>{
   const personal=recordFields(entry,'media').personal;
   return personal?.type==='media'&&matchesMediaBrowse(personal,mediaKind,options.topic);
  });
 },[type,view,rows,healthCategory,healthStatus,mediaKind,options.topic]);
 const healthFiltered=!!search.trim()||healthCategory!=='all';
 const emptyTable=type==='person'?(entries.length?'没有符合搜索条件的人物。':'暂无已确认人物。'):type==='health'
  ? (healthFiltered?'当前筛选下暂无已读记录。':'暂无站内健康记录。')
  : type==='media'&&(mediaKind!=='all'||search.trim())?'没有匹配的作品，试试其他类型或关键词。':'还没有'+title+'记录，点击“新增'+title+'”开始记录。';
 const personSpace=type==='person'&&status?status.spaceId:null;
 const allPeople=useMemo(()=>personSpace===null?[]:projectPeopleEntries(entries,personSpace),[entries,personSpace]);
 const people=useMemo(()=>{
  if(!allPeople.length)return allPeople;
  const visibleIds=new Set(rows.map(row=>row.id));
  return allPeople.filter(person=>visibleIds.has(person.id)&&(!linkedProfile||person.id===linkedProfile));
 },[allPeople,rows,linkedProfile]);
 const healthEntries=useMemo(()=>rows.map(entry=>({id:entry.id,revision:entry.revision,fields:recordFields(entry,type) as HealthPersonalFields})),[rows,type]);
 const mediaEntries=useMemo(()=>type==='media'?tableRows.map(entry=>({id:entry.id,revision:entry.revision,fields:recordFields(entry,type) as MediaPersonalFields})):[],[tableRows,type]);
 const careerEntries=useMemo(()=>type==='career'?entries.map(entry=>({id:entry.id,sourceId:entry.source.id,revision:entry.revision,fields:recordFields(entry,type) as CareerPersonalFields})):[],[entries,type]);
 const resumes=careerEntries.filter(row=>row.fields.personal.careerKind==='resume'&&rows.some(entry=>entry.id===row.id)),selectedResume=resumes.find(row=>row.id===resumeId)??resumes[0]??null;
 const portfolioEntries=useMemo(()=>type==='portfolio'?rows.map(entry=>({id:entry.id,sourceId:entry.source.id,revision:entry.revision,fields:recordFields(entry,type) as PortfolioPersonalFields})):[],[rows,type]);
 const openById=(id:string)=>{const entry=entries.find(entry=>entry.id===id);if(entry)void open(entry);};
 const recordSummary=(value:RecordFields)=>type==='person'?personSummary(value.personal as PersonPersonal).join(' · ')||'—':type==='health'?healthSummary(value as HealthPersonalFields):type==='media'?mediaSummary(value.personal as MediaPersonal).join(' · '):type==='career'?careerSummary(value.personal as CareerPersonal).join(' · '):type==='portfolio'?portfolioSummary(value.personal as PersonalPortfolio).join(' · '):value.text.replace(/\s+/g,' ').slice(0,110);
 const columns:ColumnDef<typeof dataGridFeatures,PublicEntry>[]=[{id:'title',header:type==='person'?'姓名':'标题',size:280,minSize:180,meta:{fillWidth:true},cell:({row})=><Button variant="ghost" className={s.titleButton} onClick={()=>void open(row.original)}>{recordFields(row.original,type).title}</Button>},{id:'summary',header:type==='person'?'关系与生日':type==='health'?'记录摘要':'正文摘要',size:360,cell:({row})=>{const value=recordFields(row.original,type);return <span className={s.summary}>{recordSummary(value)}</span>;}},{id:'date',header:'记录日期',size:130,cell:({row})=>recordFields(row.original,type).occurredOn??'—'}];
 const table=useTable({features:dataGridFeatures,data:tableRows,columns,getRowId:entry=>entry.id,enableRowSelection:false,state:{pagination:{pageIndex:0,pageSize:Math.max(tableRows.length,1)}},autoResetPageIndex:false});
 const careerRecord=type==='career'&&editor?.entry?{id:editor.entry.id,sourceId:editor.entry.source.id,revision:editor.entry.revision,fields:recordFields(editor.entry,'career') as CareerPersonalFields}:null;
 const fields=editor?.fields,links=fields?.personal?.type==='journal'?fields.personal.links:emptyLinks();
 const setFields=(fields:RecordFields)=>setEditor(old=>old?{...old,fields}:old);
 function peoplePins(values:PersonalReference[]){return <label>关联人物<select multiple value={values.map(value=>JSON.stringify(value))} onChange={event=>setFields({...fields!,personal:{type:'journal',links:{...links,people:[...event.target.selectedOptions].map(option=>JSON.parse(option.value))}}})}>{values.filter(value=>!options.person.some(entry=>entry.id===value.id&&entry.source.id===value.sourceId&&entry.revision===value.revision)).map(value=><option key={value.id} value={JSON.stringify(value)}>保留原人物引用（版本 {value.revision}）</option>)}{options.person.map(entry=><option key={entry.id} value={JSON.stringify({id:entry.id,sourceId:entry.source.id,revision:entry.revision})}>{recordFields(entry,'person').title}</option>)}</select></label>;}
 const toolbar=<div className={s.toolbar}><Input aria-label={'搜索'+title} placeholder={'搜索'+title} value={search} onChange={e=>{setLinkedProfile(undefined);setSearch(e.target.value);}}/><span className={s.count}>{status?(type==='media'?tableRows.length:sectionEntries.length)+' 条':'正在读取'}</span>
   {type==='media'&&<label className={s.metric}>筛选作品<select value={mediaKind} disabled={!status} onChange={event=>setMediaKind(event.target.value as MediaBrowseFilter)}>
    <option value="all">全部作品</option>
    {mediaBrowseGroups.map(group=><optgroup key={group.label} label={group.label}>
     {group.options.map(([kind,label])=><option key={kind} value={kind}>{label}</option>)}
    </optgroup>)}
   </select></label>}
   {type==='person'&&<div className={s.views} aria-label="人物视图"><Button variant={view==='table'?'secondary':'ghost'} aria-pressed={view==='table'} disabled={!status} onClick={()=>{setLinkedProfile(undefined);setView('table');}}>人物列表</Button><Button variant={view==='overview'?'secondary':'ghost'} aria-pressed={view==='overview'} disabled={!status} onClick={()=>setView('overview')}>人物概览</Button></div>}{type==='health'&&<div className={s.views}><Button variant={view==='table'?'secondary':'ghost'} onClick={()=>setView('table')}>表格</Button><Button variant={view==='trend'?'secondary':'ghost'} onClick={()=>setView('trend')}>趋势</Button><Button variant={view==='training'?'secondary':'ghost'} onClick={()=>setView('training')}>运动</Button></div>}{['media','career','portfolio'].includes(type)&&<div className={s.views} aria-label="视图"><Button variant={view==='table'?'secondary':'ghost'} onClick={()=>setView('table')}>表格</Button>{type!=='portfolio'&&careerSection!=='resume'&&<Button variant={view==='board'?'secondary':'ghost'} onClick={()=>setView('board')}>{type==='career'?'求职看板':'看板'}</Button>}{type==='career'&&careerSection!=='career'&&<Button variant={view==='resume'?'secondary':'ghost'} onClick={()=>setView('resume')}>简历</Button>}{type==='portfolio'&&<Button variant={view==='overview'?'secondary':'ghost'} onClick={()=>setView('overview')}>概览</Button>}</div>}<Button variant="outline" disabled={blocked||dirty} onClick={()=>void refresh()}>刷新</Button>{type==='person'?status?.writable&&<details className={s.personActions}><summary>更多操作</summary><Button type="button" variant="ghost" size="sm" disabled={blocked} onClick={event=>{
   const disclosure=event.currentTarget.closest('details');
   if(disclosure){disclosure.open=false;disclosure.querySelector('summary')?.focus();}
   create();
  }}>新增人物</Button></details>:<Button disabled={!status?.writable||blocked||(type==='media'&&(mediaKind==='music'||mediaKind==='photography'))} onClick={()=>create()}>新增{title}</Button>}</div>;
 const recovery=mutation?.phase==='uncertain'&&<div className={s.recovery}>
  {mutation.pending?<Button type="button" variant="outline" disabled={!mayRetry(mutation.pending.type)}
   onClick={()=>void retry()}>继续上次保存（{recordLabels[mutation.pending.type]}）</Button>:<p>保留的请求无法核对，请保留当前页面。</p>}
 </div>;
 const feedback=<>
  {error&&!(type==='journal'&&editor)&&<p role="alert" className={s.error}>{error}</p>}{notice&&<p role="status" data-record-notice>{notice}</p>}
  {!(type==='journal'&&editor)&&<>{mutation?.error&&<p role="alert">{mutation.error}</p>}{recovery}</>}
 </>;
 const records=<>
  {status&&type==='media'&&mediaKind==='novel'&&<p className={s.description}>此处显示已关联「网文」或「小说」主题的书籍。</p>}
  {status&&type==='health'&&<HealthEntriesSummary entries={healthEntries}/>}
  {status&&type==='health'&&view==='table'&&<HealthRecordFilters category={healthCategory} status={healthStatus} onCategory={value=>{if(value!==healthCategory){setHealthCategory(value);setHealthStatus('all');}}} onStatus={setHealthStatus}/>}
  {status&&type==='media'&&(mediaKind==='music'||mediaKind==='photography')?
   <p role="status" className={s.description}>{mediaKind==='music'?'暂无音乐记录，音乐来源未接入。':'暂无摄影作品，日记照片关联尚未开放。'}</p>
   :status&&view==='overview'&&type==='person'?<div className={s.contentView}><PeopleOverview people={people} allPeople={allPeople} onOpen={openById} journals={relatedJournals} journalEnabled={status.allowedTypes.includes('journal')} onBeforeNavigate={leave}/></div>:status&&view==='board'&&type==='media'?<div className={s.contentView}><MediaBoard showSearch={false} filterKind={mediaKind==='film'||mediaKind==='series'||mediaKind==='screen'?mediaKind:mediaKind==='all'?'all':'book'} records={mediaEntries} onOpenRecord={openById} onMoveRecord={(id,state)=>void move(id,state)} disabled={blocked||!!editor||!status.writable}/></div>:status&&view==='board'&&type==='career'?<div className={s.contentView}><CareerBoard records={careerEntries.filter(row=>rows.some(entry=>entry.id===row.id))} onOpenRecord={row=>openById(row.id)} onMoveRecord={(row,state)=>move(row.id,state)} disabled={blocked||!!editor||!status.writable}/></div>:status&&view==='resume'&&type==='career'?<div className={s.contentView}><label className={s.metric}>简历版本<select aria-label="简历版本" value={selectedResume?.id??''} disabled={!resumes.length} onChange={event=>setResumeId(event.target.value)}>{!selectedResume&&<option value="">暂无可预览版本</option>}{resumes.map(row=><option key={row.id} value={row.id}>{row.fields.title} · 版本 {row.revision}</option>)}</select></label><ResumePreview records={careerEntries} selected={selectedResume}/></div>:status&&view==='overview'&&type==='portfolio'?<div className={s.contentView}><PortfolioOverview records={portfolioEntries} onOpenRecord={row=>openById(row.id)} onCreateKind={status.writable&&!blocked?kind=>create(kind):undefined}/></div>:status&&view==='training'&&type==='health'?<TrainingCalendar records={healthEntries} onOpenRecord={id=>{const entry=entries.find(entry=>entry.id===id);if(entry)void open(entry);}}/>:status&&view==='trend'&&type==='health'?<><label className={s.metric}>查看指标<select value={metric} onChange={event=>setMetric(event.target.value as HealthMetric)}>{Object.entries(healthMetricLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><HealthTrendView trend={projectHealthTrend(healthEntries,metric)}/></>:status&&<div className={s.grid}><DataGridContainer><DataGrid table={table} recordCount={tableRows.length} i18n={{labels:{empty:emptyTable}}} tableLayout={{width:'fixed',headerSticky:true,columnsResizable:true,cellSelection:false}}><DataGridTableVirtual height="100%" estimateSize={44} overscan={8}/></DataGrid></DataGridContainer></div>}
 </>;
 return <div ref={root} className={s.workbench} data-personal-record-module={type}>
  {writeJournal?<><div className={s.toolbar}>
   {status?.writable===true&&verified!==false&&<Button type="button" disabled={blocked} onClick={()=>create()}>写日记</Button>}
   {!status&&error&&<Button type="button" variant="outline" disabled={busy} onClick={()=>void refresh()}>重新读取日记编辑器</Button>}
  </div>{feedback}<details className={s.personActions}><summary>管理日记</summary>{toolbar}{records}</details></>:<>{toolbar}{feedback}{records}</>}
  <Dialog open={!!editor&&verified!==false} onOpenChange={open=>{if(!open&&leave())setEditor(null);}}><DialogContent container={root.current} className={s.dialog} showCloseButton={!blocked}><DialogTitle>{editor?.entry?'编辑':'新增'}{title}</DialogTitle><DialogDescription className={s.description}>{careerSection==='resume'?'引用已保存的职业经历与项目成果，整理和预览简历版本。':recordModuleDescriptions[type]}</DialogDescription>{fields&&<form onSubmit={event=>{event.preventDefault();void save();}}><fieldset disabled={blocked||!status?.writable} className={s.form}><label>{type==='person'?'姓名':'标题'}<Input required maxLength={240} value={fields.title} onChange={event=>setFields({...fields,title:event.target.value})}/></label><label>{type==='journal'?'正文':'备注'}<textarea aria-label={type==='journal'?'正文':'备注'} required={type==='journal'} rows={type==='journal'?8:3} maxLength={16384} value={fields.text} onChange={event=>setFields({...fields,text:event.target.value})}/></label><label>记录日期<input type="date" value={fields.occurredOn??''} onChange={event=>setFields({...fields,occurredOn:event.target.value||null})}/></label>
  {type==='person'&&<PersonFields value={fields.personal as PersonPersonal} options={options} onChange={personal=>setFields({...fields,personal})}/>}
  {type==='health'&&<><label>记录类型<select value={(fields.personal as HealthPersonal).healthKind} disabled={!!editor?.entry} onChange={event=>{const next=emptyHealthFields(event.target.value as HealthPersonal['healthKind'],zone());setFields({...fields,personal:next.personal});}}>{Object.entries(healthKindLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><HealthFields value={fields.personal as HealthPersonal} lockKind={!!editor?.entry} onChange={personal=>setFields({...fields,personal})}/></>}
  {type==='media'&&<MediaFields value={fields.personal as MediaPersonal} options={options} onChange={personal=>setFields({...fields,personal})}/>}
  {type==='career'&&<CareerFields value={fields.personal as CareerPersonal} options={options} kinds={careerSection==='career'?careerKinds.filter(kind=>kind!=='resume'):undefined} lockKind={!!editor?.entry||careerSection==='resume'} onChange={personal=>setFields({...fields,personal})}/>}
  {type==='portfolio'&&<><label>持有类别<select aria-label="持有类别" disabled={!!editor?.entry} value={(fields.personal as PersonalPortfolio).portfolioKind} onChange={event=>setFields({...fields,personal:emptyPortfolioPersonal(event.target.value as PortfolioKind)})}>{portfolioKinds.map(kind=><option key={kind} value={kind}>{portfolioKindLabels[kind]}</option>)}</select></label><PortfolioFields value={fields.personal as PersonalPortfolio} options={options} onChange={personal=>setFields({...fields,personal})}/></>}
  {type==='journal'&&<div className={s.relations}><RelationFields value={links} options={options} onChange={next=>setFields({...fields,personal:{type:'journal',links:{...next,people:links.people}} as JournalPersonal})}/>{peoplePins(links.people)}</div>}
  <div className={s.actions}><Button type="button" variant="outline" onClick={()=>{if(leave())setEditor(null);}}>取消</Button><Button type="submit">保存</Button></div></fieldset></form>}
  {type==='journal'&&<>
   {error&&<p role="alert" className={s.error}>{error}</p>}
   {mutation?.error&&<p role="alert">{mutation.error}</p>}
   {mutation?.phase==='saving'&&<div className={s.recovery}><p role="status">正在等候保存回执。</p><Button type="button" variant="outline" onClick={()=>session.current?.cancel()}>停止等待并保留原请求</Button></div>}
   {recovery}
  </>}
  {careerRecord?.fields.personal.careerKind==='opportunity'&&<CareerMatch record={careerRecord} records={careerEntries}/>} {history.length>0&&<details><summary>历史版本（{history.length}）</summary><ol>{history.map(entry=><li key={entry.revision}>版本 {entry.revision} · {entry.updatedAt}<pre>{JSON.stringify(recordFields(entry,type),null,2)}</pre></li>)}</ol></details>}</DialogContent></Dialog>
 </div>;
}
