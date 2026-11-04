'use client';

import {useMemo} from 'react';
import {useTable,type ColumnDef,type HeaderContext} from '@tanstack/react-table';
import type {ImplementationStatus,Requirement,RoadmapPhase} from '../platform/requirements';
import {DataGrid,DataGridContainer,dataGridFeatures} from './reui/data-grid';
import {DataGridTable} from './reui/data-grid-table';
import {Badge} from './ui/badge';
import {Button} from './ui/button';
import styles from './requirements-page.module.css';

export const implementationLabels:Record<ImplementationStatus,string>={not_started:'未开始',partial:'部分实现',implemented:'源码已实现'};
export const acceptanceLabels:Record<Requirement['status'],string>={not_started:'尚未验收',in_progress:'开发中，未验收',awaiting_acceptance:'待本人验收',accepted:'已验收'};
export type RequirementView='table'|'board'|'gantt';
export type OpenRequirement=(item:Requirement,trigger:HTMLButtonElement)=>void;

type ViewProps={rows:Requirement[];phases:RoadmapPhase[];onOpen:OpenRequirement};
function RequirementHeader({column}:HeaderContext<typeof dataGridFeatures,Requirement,unknown>){
 const label=column.columnDef.meta?.headerTitle,direction=column.getIsSorted();
 return <Button variant="ghost" className={styles.sort} onClick={column.getToggleSortingHandler()} aria-label={`按${label}排序`}>{label}<span aria-hidden="true">{direction==='asc'?'↑':direction==='desc'?'↓':'↕'}</span></Button>;
}
function RequirementTitle({item,onOpen}:{item:Requirement;onOpen:OpenRequirement}){
 return <div data-requirement-id={item.id} className={styles.requirementTitle}><button type="button" className={styles.titleButton} onClick={event=>onOpen(item,event.currentTarget)} aria-label={`查看需求 ${item.id} ${item.title}`}><span className={styles.id}>{item.id}</span><span>{item.title}</span></button></div>;
}
export function RequirementsTable({rows,phases,onOpen}:ViewProps){
 const columns=useMemo<ColumnDef<typeof dataGridFeatures,Requirement>[]>(()=>{
  const phaseTitles=new Map(phases.map(phase=>[phase.id,phase.title]));
  return ([['title','需求',260],['phase','阶段',180],['priority','优先级',100],['implementation','实现',140],['acceptance','验收',170],['next','下一步',280]] as const).map(([id,title,size])=>({
   id,size,minSize:id==='priority'?90:120,header:RequirementHeader,meta:{headerTitle:title,cellClassName:styles.cell},
   accessorFn:item=>id==='title'?item.title:id==='phase'?phaseTitles.get(item.roadmap?.phaseId??'')??'未排阶段':id==='priority'?item.roadmap?.priority??'待定':id==='implementation'?item.roadmap?implementationLabels[item.roadmap.implementation]:'待核验':id==='acceptance'?acceptanceLabels[item.status]:item.roadmap?.nextStep??'按验收条件验证',
   cell:({row,getValue})=>id==='title'?<RequirementTitle item={row.original} onOpen={onOpen}/>:<span className={id==='next'?styles.nextCell:styles.value}>{String(getValue())}</span>,
  }));
 },[phases,onOpen]);
 const table=useTable({features:dataGridFeatures,data:rows,columns,getRowId:item=>item.id,state:{pagination:{pageIndex:0,pageSize:Math.max(rows.length,1)}},enableRowSelection:false,autoResetPageIndex:false});
 return <div className={styles.tableContainer} data-requirements-grid="reui" aria-label="需求表格">
  <DataGridContainer className={styles.gridContainer}><DataGrid table={table} recordCount={rows.length} i18n={{labels:{empty:'没有匹配的需求',loading:'正在加载需求…',allRowsLoaded:'已显示全部需求'}}} tableLayout={{width:'fixed',headerSticky:true,columnsResizable:true,columnsResizeMode:'onEnd',cellSelection:false}} tableClassNames={{base:styles.table,headerRow:styles.header,bodyRow:styles.row}}><DataGridTable/></DataGrid></DataGridContainer>
 </div>;
}
export function RequirementsBoard({rows,phases,onOpen}:ViewProps){
 return <div className={styles.board} aria-label="按阶段查看需求">{phases.map(phase=>{
  const items=rows.filter(item=>item.roadmap?.phaseId===phase.id);
  return <section key={phase.id} className={styles.column} aria-label={phase.title}><header className={styles.columnHeader}><h3>{phase.title}</h3><span>{items.length}</span></header><div className={styles.cards}>{items.map(item=><article className={styles.card} key={item.id}><RequirementTitle item={item} onOpen={onOpen}/><div className={styles.badges}><Badge variant="outline">{item.roadmap?.priority??'待定'}</Badge><Badge variant="secondary">{item.roadmap?implementationLabels[item.roadmap.implementation]:'待核验'}</Badge><span>{acceptanceLabels[item.status]}</span></div></article>)}{items.length===0?<p className={styles.empty}>没有匹配的需求</p>:null}</div></section>;
 })}</div>;
}
/** There are no planning dates in this baseline. Phase order never becomes a date interval. */
export function RequirementsGantt({rows,onOpen}:Pick<ViewProps,'rows'|'onOpen'>){
 return <section className={styles.gantt} aria-label="需求甘特"><header className={styles.ganttHeader}><h3>未排期（{rows.length}）</h3><p>尚未设置计划日期</p></header><div className={styles.unscheduled}>{rows.map(item=><article className={styles.unscheduledRow} key={item.id}><RequirementTitle item={item} onOpen={onOpen}/><div className={styles.badges}><Badge variant="outline">{item.roadmap?.priority??'待定'}</Badge><span>未排期</span></div></article>)}{rows.length===0?<p className={styles.empty}>没有匹配的需求</p>:null}</div></section>;
}
