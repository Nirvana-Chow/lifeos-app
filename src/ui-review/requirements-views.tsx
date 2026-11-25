'use client';

import {useMemo} from 'react';
import {useTable,columnGroupingFeature,createGroupedRowModel,tableFeatures,type ColumnDef,type HeaderContext} from '@tanstack/react-table';
import type {ImplementationStatus,Requirement,RoadmapPhase} from '../platform/requirements';
import {DataGrid,DataGridContainer,dataGridFeatures} from './reui/data-grid';
import {DataGridTable} from './reui/data-grid-table';
import {Badge} from './ui/badge';
import {Button} from './ui/button';
import type {RequirementWorkflow} from '../requirements-candidate/domain';
import {requirementSchedule,type PlannedDates} from '../requirements-candidate/planning';
import {workflowProgressLabels,workflowState,developmentQueueOrder} from './requirements-progress';
import {deliveryLabels,formatDeliveryTime,type RequirementDelivery} from './requirements-delivery';
import styles from './requirements-page.module.css';

export const implementationLabels:Record<ImplementationStatus,string>={not_started:'未开始',partial:'部分实现',implemented:'源码已实现'};
export const acceptanceLabels:Record<Requirement['status'],string>={not_started:'尚未验收',in_progress:'开发中，未验收',awaiting_acceptance:'待本人验收',accepted:'已验收'};
export const workflowLabels:Record<RequirementWorkflow['state'],string>={planned:'待开发',in_progress:'进行中',blocked:'有阻塞',awaiting_review:'待工程检查',done:'开发完成'};
export type RequirementWorkflowMap=ReadonlyMap<string,RequirementWorkflow|null|undefined>;
export function RequirementWorkflowSummary({workflow}:{workflow?:RequirementWorkflow|null}){return workflow?<div className={styles.workflowSummary} data-requirement-workflow><Badge variant="secondary" className={styles.semanticBadge} data-workflow={workflow.state}>推进：{workflowLabels[workflow.state]}</Badge>{workflow.purpose?<span title={workflow.purpose}>{workflow.purpose}</span>:null}</div>:null;}
export type RequirementView='table'|'board'|'gantt';
export type RequirementGrouping='none'|'phase'|'implementation'|'priority'|'acceptance'|'workflow'|'delivery';
export const requirementProgressLabels={not_started:'未开始',in_progress:'正在推进',implemented:'已实现，未验收',awaiting_acceptance:'待本人审查',accepted:'已验收',unknown:'待核验'} as const;
/** Engineering evidence and explicit owner acceptance drive development columns.
 * Saved business workflow remains visible, without promoting its done marker. */
export function requirementProgress(item:Requirement):keyof typeof requirementProgressLabels {
 if(item.status==='accepted')return 'accepted';
 if(item.status==='awaiting_acceptance')return 'awaiting_acceptance';
 return item.roadmap?.implementation==='implemented'?'implemented':item.roadmap?.implementation==='partial'?'in_progress':item.roadmap?.implementation==='not_started'?'not_started':'unknown';
}
export type OpenRequirement=(item:Requirement,trigger:HTMLButtonElement)=>void;

const requirementFeatures=tableFeatures({...dataGridFeatures,columnGroupingFeature,groupedRowModel:createGroupedRowModel()});
const phaseColor=(id:string)=>['foundation','integration','workspace','business','qualification','personal-agent'].indexOf(id);
type ViewProps={rows:Requirement[];phases:RoadmapPhase[];onOpen:OpenRequirement;workflow?:RequirementWorkflowMap;delivery?:ReadonlyMap<string,RequirementDelivery>};
function RequirementHeader({column}:HeaderContext<typeof requirementFeatures,Requirement,unknown>){
 const label=column.columnDef.meta?.headerTitle,direction=column.getIsSorted();
 return <Button variant="ghost" className={styles.sort} onClick={column.getToggleSortingHandler()} aria-label={`按${label}排序`}>{label}<span aria-hidden="true">{direction==='asc'?'↑':direction==='desc'?'↓':'↕'}</span></Button>;
}
function RequirementTitle({item,onOpen,workflow,queueOrder}:{item:Requirement;onOpen:OpenRequirement;workflow?:RequirementWorkflow|null;queueOrder?:number|null}){
 return <div data-requirement-id={item.id} className={styles.requirementTitle}><button type="button" data-slot="requirement-title-trigger" className={styles.titleButton} onClick={event=>onOpen(item,event.currentTarget)} aria-label={`查看需求 ${item.id} ${item.title}`}><span className={styles.id} title={item.id}>{item.id.startsWith('LO-')?item.id:'私有 · '+item.id.slice(0,8)}{queueOrder?' · 顺序 '+queueOrder:''}</span><span className={styles.titleText} title={item.title}>{item.title}</span></button><RequirementWorkflowSummary workflow={workflow}/></div>;
}
export function RequirementsTable({rows,phases,onOpen,workflow,delivery,grouping='phase',planning}:ViewProps&{grouping?:RequirementGrouping;planning?:ReadonlyMap<string,{body:string}>}){
 const columns=useMemo<ColumnDef<typeof requirementFeatures,Requirement>[]>(()=>{
  const phaseTitles=new Map(phases.map(phase=>[phase.id,phase.title]));
  const compact=!!delivery&&grouping==='none';
  return ([...(grouping==='workflow'?[['workflow','推进状态',130] as const]:[]),['title','需求',260],...(delivery?[['delivery','交付状态',150],['time','时间',200],['result','结果',185]] as const:[]),...(!delivery||grouping==='phase'?[['phase','阶段',180]] as const:[]),...(!compact?[['priority','优先级',100]] as const:[]),...(!delivery||grouping==='implementation'?[['implementation','源码进度',140]] as const:[]),...(!delivery||grouping==='acceptance'?[['acceptance','验收',170]] as const:[]),...(!compact?[['next','下一步',240]] as const:[])] as const).map(([id,title,size])=>({
   id,size,minSize:id==='priority'?90:120,header:RequirementHeader,meta:{headerTitle:title,cellClassName:styles.cell,fillWidth:id==='title'},
   accessorFn:item=>{
    const proof=delivery?.get(item.id);
    if(id==='time')return proof?.time?Date.parse(proof.time.at):undefined;
    return id==='delivery'?deliveryLabels[proof?.state??'unverified']:id==='result'?delivery?.get(item.id)?.result?.label??'':id==='workflow'?workflowProgressLabels[workflowState(item.id,workflow)]:id==='title'?item.title:id==='phase'?phaseTitles.get(item.roadmap?.phaseId??'')??'未排阶段':id==='priority'?item.roadmap?.priority??'待定':id==='implementation'?(item.roadmap?.implementation?implementationLabels[item.roadmap.implementation]:'待核验'):id==='acceptance'?acceptanceLabels[item.status]:workflow?.get(item.id)?.nextStep??item.roadmap?.nextStep??'按验收条件验证';
   },
   cell:({row,getValue})=>row.getIsGrouped()?id==='title'?<span className={styles.phaseGroup} data-requirements-group={grouping} data-requirements-phase={grouping==='phase'?row.subRows[0]?.original.roadmap?.phaseId??'unassigned':undefined} data-phase-tone={phaseColor(row.subRows[0]?.original.roadmap?.phaseId??'')}><strong>{String(row.groupingValue)}</strong><span>{row.subRows.length} 项</span></span>:null:id==='title'?<RequirementTitle item={row.original} queueOrder={developmentQueueOrder(planning?.get(row.original.id)?.body??'')} onOpen={onOpen} workflow={delivery?undefined:workflow?.get(row.original.id)}/>:id==='time'?<RequirementDeliveryTime delivery={delivery?.get(row.original.id)}/>:id==='result'?<RequirementResultLink delivery={delivery?.get(row.original.id)}/>:id==='delivery'||id==='priority'||id==='implementation'||id==='acceptance'?<Badge variant="secondary" className={styles.semanticBadge} data-priority={id==='priority'?row.original.roadmap?.priority:undefined} data-implementation={id==='implementation'?row.original.roadmap?.implementation:undefined} data-acceptance={id==='acceptance'?row.original.status:undefined}>{String(getValue())}</Badge>:<span className={id==='next'?styles.nextCell:styles.value}>{String(getValue())}</span>,
  }));
 },[phases,onOpen,workflow,delivery,grouping,planning]);
 const table=useTable({features:requirementFeatures,data:rows.toSorted((a,b)=>(developmentQueueOrder(planning?.get(a.id)?.body??'')??Infinity)-(developmentQueueOrder(planning?.get(b.id)?.body??'')??Infinity)||(a.roadmap?.priority??'P9').localeCompare(b.roadmap?.priority??'P9')||(phases.find(p=>p.id===a.roadmap?.phaseId)?.order??99)-(phases.find(p=>p.id===b.roadmap?.phaseId)?.order??99)),columns,getRowId:item=>item.id,state:{grouping:grouping==='none'?[]:[grouping],expanded:true,pagination:{pageIndex:0,pageSize:Math.max(rows.length*2,1)}},groupedColumnMode:false,enableRowSelection:false,autoResetPageIndex:false});
 return <div className={styles.tableContainer} data-requirements-grid="reui" aria-label="需求表格">
  <DataGridContainer className={styles.gridContainer}><DataGrid table={table} recordCount={rows.length} i18n={{labels:{empty:'没有匹配的需求',loading:'正在加载需求…',allRowsLoaded:'已显示全部需求'}}} tableLayout={{width:'fixed',headerSticky:true,columnsResizable:true,columnsResizeMode:'onEnd',cellSelection:false}} tableClassNames={{base:styles.table,headerRow:styles.header,bodyRow:styles.row}}><DataGridTable/></DataGrid></DataGridContainer>
 </div>;
}
export function RequirementDeliveryTime({delivery}:{delivery?:RequirementDelivery}){
 const time=delivery?.time;
 return time?<span className={styles.deliveryTime}><time dateTime={time.at} title="北京时间">{formatDeliveryTime(time.at)}</time><span>{time.label}</span></span>:<span className={styles.deliveryTime}>待核实</span>;
}

export function RequirementResultLink({delivery}:{delivery?:RequirementDelivery}){
 const result=delivery?.result;
 return result?<a className={styles.resultLink} href={result.href} target="_blank" rel="noreferrer">{result.label}</a>:null;
}

export function RequirementsBoard({rows,phases,onOpen,workflow,delivery,progressMode='engineering'}:ViewProps&{progressMode?:'engineering'|'workflow'|'delivery'}){
 const phaseTitles=new Map(phases.map(phase=>[phase.id,phase.title]));
 const labels:Record<string,string>=progressMode==='delivery'?deliveryLabels:progressMode==='workflow'?workflowProgressLabels:requirementProgressLabels;
 const progress=(item:Requirement):string=>progressMode==='delivery'?delivery?.get(item.id)?.state??'unverified':progressMode==='workflow'?workflowState(item.id,workflow):requirementProgress(item);
 const states=Object.keys(labels).filter(state=>progressMode!=='engineering'||!['accepted','unknown'].includes(state)||rows.some(item=>requirementProgress(item)===state));
 return <div className={styles.board} aria-label={progressMode==='delivery'?'按交付状态查看需求':progressMode==='workflow'?'按推进状态查看需求':'按开发进度查看需求'}>{states.map(state=>{
  const items=rows.filter(item=>progress(item)===state);
  return <section key={state} data-requirements-progress={state} className={styles.column} aria-label={labels[state]}><header className={styles.columnHeader}><h3>{labels[state]}</h3><span>{items.length}</span></header><div className={styles.cards}>{items.map(item=><article className={styles.card} key={item.id}><RequirementTitle item={item} onOpen={onOpen} workflow={progressMode==='delivery'?undefined:workflow?.get(item.id)}/><div className={styles.badges}><span>{phaseTitles.get(item.roadmap?.phaseId??'')??'未排阶段'}</span><Badge variant="outline" className={styles.semanticBadge} data-priority={item.roadmap?.priority}>{item.roadmap?.priority??'待定'}</Badge><Badge variant="secondary" className={styles.semanticBadge} data-acceptance={item.status}>{acceptanceLabels[item.status]}</Badge></div><RequirementResultLink delivery={delivery?.get(item.id)}/>{workflow?.get(item.id)?.nextStep?<p className={styles.boardNext}>下一步：{workflow.get(item.id)!.nextStep}</p>:null}</article>)}{items.length===0?<p className={styles.empty}>没有匹配的需求</p>:null}</div></section>;
 })}</div>;
}
/** Date positions come from persistent fields; phase order never invents dates. */
export function RequirementsGantt({rows,planning=new Map(),onOpen,onShowTable,workflow}:Pick<ViewProps,'rows'|'onOpen'|'workflow'>&{phases?:RoadmapPhase[];planning?:ReadonlyMap<string,PlannedDates>;onShowTable?:()=>void}){
 const schedule=requirementSchedule(rows,planning),unscheduled=schedule.unscheduled;
 return <section className={styles.gantt} aria-label="需求甘特"><header className={styles.ganttHeader}><h3>{schedule.scheduled.length?'计划日期 · '+schedule.scheduled.length+' 项':'未排期（'+rows.length+'）'}</h3><p>{schedule.scheduled.length?'只显示已保存的完整起止日期':'尚无完整排期；设置计划开始和结束日期后显示甘特条'}</p>{onShowTable&&<Button variant="outline" onClick={onShowTable}>查看需求表格</Button>}</header>
 {schedule.scheduled.length?<section className={styles.timeline} aria-label="已排期需求"><div className={styles.timelineScale}><span>{schedule.minOn}</span><span>{schedule.maxOn}</span></div>{schedule.scheduled.map(row=><article className={styles.timelineRow} data-phase-tone={phaseColor(row.item.roadmap?.phaseId??'')} key={row.item.id}><RequirementTitle item={row.item} onOpen={onOpen} workflow={workflow?.get(row.item.id)}/><div className={styles.timelineTrack} role="img" aria-label={`计划 ${row.startOn} 至 ${row.endOn}`}><span data-gantt-bar="" className={styles.timelineBar} style={{left:`min(${row.left}%,calc(100% - 4px))`,width:`max(4px,${row.width}%)`}}/><span className={styles.timelineDate}>{`${row.startOn} — ${row.endOn}`}</span></div></article>)}</section>:null}
 {schedule.scheduled.length>0&&unscheduled.length>0?<h3 className={styles.unscheduledPhase}>未排期（{unscheduled.length}）</h3>:null}{rows.length===0?<p className={styles.empty}>没有匹配的需求</p>:null}</section>;
}
