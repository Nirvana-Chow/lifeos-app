'use client';
import type {ReactNode} from 'react';
import {requirementSchedule} from '../requirements-candidate/planning';
import type {PersonalPlanningFields} from '../personal-candidate/planning';
import {Button} from './ui/button';
import styles from './task-project-gantt.module.css';
type Row={id:string;title:string;dueOn?:string|null}&PersonalPlanningFields;
/** Read-only date projection. Dates come only from the host's verified saved records. */
export function TaskProjectGantt<T extends Row>({label,rows,partial,onShowTable,renderTitle}:{label:'待办'|'项目';rows:readonly T[];partial:boolean;onShowTable:()=>void;renderTitle:(row:T)=>ReactNode}){
 const schedule=requirementSchedule(rows,new Map(rows.map(row=>[row.id,{plannedStartOn:row.plannedStartOn??null,plannedEndOn:row.plannedEndOn??null}])));
 // A deadline is a point, never a substitute for a missing plan endpoint.
 const deadlines=requirementSchedule(label==='待办'?schedule.unscheduled:[],new Map(rows.map(row=>[row.id,{plannedStartOn:row.dueOn??null,plannedEndOn:row.dueOn??null}])));
 const deadlineIds=new Set(deadlines.scheduled.map(row=>row.item.id)),undated=schedule.unscheduled.filter(row=>!deadlineIds.has(row.id));
 return <section className={[styles.gantt,label==='待办'?styles.todo:''].filter(Boolean).join(' ')} aria-label={`${label}甘特`}><header><h2>{schedule.scheduled.length?`已排期 · ${schedule.scheduled.length} 项${label}`:'尚无完整排期'}</h2><p>{label==='待办'?'条形表示已保存的计划区间，菱形仅表示截止日期；未完整排期的待办仍可查看。':'仅显示已保存的计划起止日期；到期日和阶段不会作为计划区间。'}</p>{partial&&<p role="status">当前仅显示已读取范围，完整排期数量尚不能确认。</p>}<Button variant="outline" onClick={onShowTable}>查看{label}表格</Button></header><div className={styles.viewport}>
 {schedule.scheduled.length>0&&<div className={styles.timeline} aria-label={`已排期${label}`}><div className={styles.scale}><span>{schedule.minOn}</span><span>{schedule.maxOn}</span></div>{schedule.scheduled.map(({item,startOn,endOn,left,width})=><article className={styles.row} key={item.id} data-gantt-record={item.id}>{renderTitle(item)}<div className={styles.track} role="img" aria-label={`计划 ${startOn} 至 ${endOn}`}><span data-gantt-bar="" className={styles.bar} style={{left:`${left}%`,width:`max(4px,${width}%)`}}/><span className={styles.dates}>{startOn} — {endOn}</span></div></article>)}</div>}
 {schedule.scheduled.length===0&&(label==='项目'||rows.length===0)&&<p className={styles.empty}>{rows.length?'保存计划开始和结束日期后显示甘特条。':`没有符合条件的${label}`}</p>}
 {deadlines.scheduled.length>0&&<section className={styles.timeline} aria-label="待办截止日期"><h3>仅截止日期 · {deadlines.scheduled.length} 项待办</h3><div className={styles.scale}><span>{deadlines.minOn}</span><span>{deadlines.maxOn}</span></div>{deadlines.scheduled.map(({item,startOn,left})=><article className={styles.row} key={item.id} data-gantt-record={item.id}>{renderTitle(item)}<div className={styles.track} role="img" aria-label={`截止 ${startOn}`}><span data-gantt-milestone="" className={styles.milestone} style={{left:`clamp(6px, ${left}%, calc(100% - 6px))`}}/><span className={styles.dates}>截止 <time dateTime={startOn}>{startOn}</time></span></div></article>)}</section>}
 {label==='待办'&&undated.length>0&&<section className={styles.unscheduled} aria-label="未完整排期待办"><h3>未完整排期 · {undated.length} 项待办</h3>{undated.map(item=><article className={styles.row} key={item.id} data-gantt-record={item.id}>{renderTitle(item)}<span className={styles.metadata}>{item.plannedStartOn?`计划开始 ${item.plannedStartOn}`:null}{item.plannedStartOn&&item.plannedEndOn?'；':null}{item.plannedEndOn?`计划结束 ${item.plannedEndOn}`:null}{!item.plannedStartOn&&!item.plannedEndOn?'尚未排期':null}</span></article>)}</section>}
 {label==='项目'&&schedule.unscheduled.length>0&&<p className={styles.empty}>{schedule.unscheduled.length} 项{label}未完整排期，可在表格中查看。</p>}
 </div></section>;
}
