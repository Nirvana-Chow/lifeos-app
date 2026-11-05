'use client';
import {applicationStates,type ApplicationState} from './domain';
import {applicationStateLabels,projectCareerBoard,type CareerRecord} from './projection';
import s from './career.module.css';

export function CareerBoard({records,onOpenRecord,onMoveRecord,disabled=false}:{records:readonly CareerRecord[];onOpenRecord:(record:CareerRecord)=>void;onMoveRecord?:(record:CareerRecord,state:ApplicationState)=>void|Promise<void>;disabled?:boolean}){
 const columns=projectCareerBoard(records),count=columns.reduce((sum,column)=>sum+column.records.length,0);
 return <section aria-label="求职看板" className={s.boardWrap}><h2>求职看板</h2>{count===0?<p className={s.hint}>暂无职位记录。添加职位与 JD 后，从已收藏开始；进展由本人更新。</p>:null}<div className={s.board}>{columns.map(column=><section key={column.state} className={s.column} aria-label={applicationStateLabels[column.state]}><h3>{applicationStateLabels[column.state]} <span>{column.records.length}</span></h3>{column.records.length?column.records.map(record=>{
 const p=record.fields.personal;if(p.careerKind!=='opportunity')return null;
 return <article className={s.card} key={record.id}><button data-slot="personal-record-action" type="button" disabled={disabled} className={s.open} onClick={()=>onOpenRecord(record)}>{record.fields.title}</button><p>{p.company??'公司未知'} · {p.role??'岗位未知'}</p>{p.direction?<p>{p.direction}</p>:null}{p.nextStep?<p>下一步：{p.nextStep}</p>:<p className={s.hint}>下一步未填</p>}{p.nextStepOn?<p>日期：{p.nextStepOn}</p>:null}{onMoveRecord?<label>更新状态<select aria-label="更新状态" name={'careerState-'+record.id} value={p.applicationState} disabled={disabled} onChange={event=>void onMoveRecord(record,event.target.value as ApplicationState)}>{applicationStates.map(state=><option key={state} value={state}>{applicationStateLabels[state]}</option>)}</select></label>:null}</article>;
 }):<p className={s.hint}>暂无记录</p>}</section>)}</div></section>;
}
