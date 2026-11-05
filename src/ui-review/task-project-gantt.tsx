'use client';
import type {ReactNode} from 'react';
import {requirementSchedule} from '../requirements-candidate/planning';
import type {PersonalPlanningFields} from '../personal-candidate/planning';
import {Button} from './ui/button';
import styles from './task-project-gantt.module.css';
type Row={id:string;title:string}&PersonalPlanningFields;
/** Read-only date projection. Dates come only from the host's verified saved records. */
export function TaskProjectGantt<T extends Row>({label,rows,partial,onShowTable,renderTitle}:{label:'待办'|'项目';rows:readonly T[];partial:boolean;onShowTable:()=>void;renderTitle:(row:T)=>ReactNode}){
 const schedule=requirementSchedule(rows,new Map(rows.map(row=>[row.id,{plannedStartOn:row.plannedStartOn??null,plannedEndOn:row.plannedEndOn??null}])));
 return <section className={styles.gantt} aria-label={`${label}甘特`}><header><h2>{schedule.scheduled.length?`已排期 · ${schedule.scheduled.length} 项${label}`:'尚无完整排期'}</h2><p>仅显示已保存的计划起止日期；到期日和阶段不会作为计划区间。</p>{partial&&<p role="status">当前仅显示已读取范围，完整排期数量尚不能确认。</p>}<Button variant="outline" onClick={onShowTable}>查看{label}表格</Button></header><div className={styles.viewport}>
 {schedule.scheduled.length>0&&<div className={styles.timeline} aria-label={`已排期${label}`}><div className={styles.scale}><span>{schedule.minOn}</span><span>{schedule.maxOn}</span></div>{schedule.scheduled.map(({item,startOn,endOn,left,width})=><article className={styles.row} key={item.id} data-gantt-record={item.id}>{renderTitle(item)}<div className={styles.track} role="img" aria-label={`计划 ${startOn} 至 ${endOn}`}><span data-gantt-bar="" className={styles.bar} style={{left:`${left}%`,width:`max(4px,${width}%)`}}/><span className={styles.dates}>{startOn} — {endOn}</span></div></article>)}</div>}
 {schedule.scheduled.length===0&&<p className={styles.empty}>{rows.length?'保存计划开始和结束日期后显示甘特条。':`没有符合条件的${label}`}</p>}
 {schedule.unscheduled.length>0&&<p className={styles.empty}>{schedule.unscheduled.length} 项{label}未完整排期，可在表格中查看。</p>}
 </div></section>;
}
