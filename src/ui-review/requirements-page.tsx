'use client';

import {useCallback,useMemo,useRef,useState} from 'react';
import {requirements,selectRequirements,type Requirement,type RequirementFilters} from '../platform/requirements';
import {RequirementsTable,RequirementsBoard,RequirementsGantt,implementationLabels,acceptanceLabels,type RequirementView} from './requirements-views';
import {RequirementDetail} from './requirements-detail';
import styles from './requirements-page.module.css';

const baseline=requirements();
const phases=baseline.roadmap?.phases.toSorted((a,b)=>a.order-b.order)??[];
const viewLabels:Record<RequirementView,string>={table:'表格',board:'看板',gantt:'甘特'};

/** Public product metadata only; the authenticated host owns navigation and access checks. */
export function RequirementsPage(){
 const [filters,setFilters]=useState<RequirementFilters>({});
 const [view,setView]=useState<RequirementView>('table');
 const [selected,setSelected]=useState<Requirement|null>(null);
 const [expanded,setExpanded]=useState(false);
 const opener=useRef<HTMLButtonElement|null>(null),viewButton=useRef<HTMLButtonElement|null>(null);
 const rows=useMemo(()=>selectRequirements(baseline,filters),[filters]);
 const open=useCallback((item:Requirement,trigger:HTMLButtonElement)=>{opener.current=trigger;setExpanded(false);setSelected(item);},[]);
 const route=baseline.roadmap,current=phases.find(phase=>phase.id===route?.currentPhaseId);
 const setFilter=(name:keyof RequirementFilters,value:string)=>setFilters(previous=>({...previous,[name]:value}));
 return <section className={styles.page} aria-label="需求池" data-requirements-page>
  <header className={styles.intro}><p>{route?.goal??baseline.scopeNote}</p><div className={styles.route}><span>当前阶段：<strong>{current?.title??'待明确'}</strong></span><span className={styles.routeNext}>下一步：{route?.nextStep??'逐项补充验收证据。'}</span></div></header>
  <div className={styles.controls}>
   <div className={styles.filters} role="search" aria-label="筛选需求">
    <label htmlFor="requirements-search">搜索需求<input id="requirements-search" type="search" placeholder="标题、编号或来源" value={filters.query??''} onChange={event=>setFilter('query',event.target.value)}/></label>
    <div className={styles.filterField}><label htmlFor="requirements-phase">阶段</label><select id="requirements-phase" value={filters.phase??'all'} onChange={event=>setFilter('phase',event.target.value)}><option value="all">全部阶段</option>{phases.map(phase=><option key={phase.id} value={phase.id}>{phase.title}</option>)}</select></div>
    <div className={styles.filterField}><label htmlFor="requirements-priority">优先级</label><select id="requirements-priority" value={filters.priority??'all'} onChange={event=>setFilter('priority',event.target.value)}><option value="all">全部优先级</option>{['P0','P1','P2'].map(priority=><option key={priority}>{priority}</option>)}</select></div>
    <div className={styles.filterField}><label htmlFor="requirements-implementation">实现状态</label><select id="requirements-implementation" value={filters.implementation??'all'} onChange={event=>setFilter('implementation',event.target.value)}><option value="all">全部实现状态</option>{Object.entries(implementationLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
    <div className={styles.filterField}><label htmlFor="requirements-acceptance">验收状态</label><select id="requirements-acceptance" value={filters.acceptance??'all'} onChange={event=>setFilter('acceptance',event.target.value)}><option value="all">全部验收状态</option>{Object.entries(acceptanceLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
   </div>
   <div className={styles.viewBar}><div className={styles.viewSwitch} role="group" aria-label="需求视图">{Object.entries(viewLabels).map(([key,label])=><button key={key} ref={view===key?viewButton:undefined} type="button" aria-pressed={view===key} aria-label={`${label}视图`} onClick={()=>setView(key as RequirementView)}>{label}</button>)}</div><p role="status" aria-live="polite">{rows.length} / {baseline.requirements.length} 项</p></div>
  </div>
  <div className={styles.view}>{view==='table'?<RequirementsTable rows={rows} phases={phases} onOpen={open}/>:view==='board'?<RequirementsBoard rows={rows} phases={phases} onOpen={open}/>:<RequirementsGantt rows={rows} onOpen={open}/>}</div>
  <RequirementDetail item={selected} phaseTitle={phases.find(phase=>phase.id===selected?.roadmap?.phaseId)?.title??'未排阶段'} expanded={expanded} onExpandedChange={()=>setExpanded(value=>!value)} onClose={()=>setSelected(null)} returnFocus={()=>{(opener.current?.isConnected?opener.current:viewButton.current)?.focus();}}/>
 </section>;
}
