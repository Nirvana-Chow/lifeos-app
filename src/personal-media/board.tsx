'use client';
import {useId,useMemo,useState} from 'react';
import {BookOpen,Clapperboard,Tv} from 'lucide-react';
import {mediaKinds,mediaStates,type MediaKind,type MediaState} from './domain';
import {projectMediaBoard,mediaKindLabels,mediaStateLabels,mediaProgressLabel,mediaProgressPercent,type MediaEntry} from './projection';
import styles from './media.module.css';
const icons={book:BookOpen,film:Clapperboard,series:Tv};
export function MediaBoard({records,onOpenRecord,onMoveRecord,disabled=false}:{records:readonly MediaEntry[];onOpenRecord:(id:string)=>void;onMoveRecord?:(id:string,state:MediaState)=>void;disabled?:boolean}){
 const [kind,setKind]=useState<MediaKind|'all'>('all'),[search,setSearch]=useState(''),identity=useId();
 const board=useMemo(()=>projectMediaBoard(records,{kind,search}),[records,kind,search]);
 return <section className={styles.board} aria-label="阅读与观影书架">
  <div className={styles.toolbar}><label>筛选作品<select value={kind} onChange={event=>setKind(event.target.value as MediaKind|'all')}><option value="all">全部作品</option>{mediaKinds.map(value=><option key={value} value={value}>{mediaKindLabels[value]}</option>)}</select></label><label>搜索作品<input type="search" placeholder="作品、创作者、ISBN" value={search} onChange={event=>setSearch(event.target.value)}/></label></div>
  <p className={styles.hint} role="status">当前显示 {board.total} 部作品 · {board.inProgress} 部进行中 · {board.completed} 部已完成</p>
  {board.total===0?<p className={styles.empty}>{records.length?'没有匹配的作品，试试其他类型或关键词。':'暂无阅读与观影记录。添加想读的书、想看的电影或剧集后，会在这里按状态排列。'}</p>:<div className={styles.columns}>{board.columns.map(column=><section className={styles.column} key={column.state} aria-labelledby={identity+column.state}>
   <h3 id={identity+column.state}>{column.label}<span aria-label={`${column.records.length} 部作品`}>{column.records.length}</span></h3>
   {column.records.length===0?<p className={styles.columnEmpty}>暂无作品</p>:<ul>{column.records.map(record=>{const p=record.fields.personal,Icon=icons[p.mediaKind],progress=mediaProgressLabel(p),percent=mediaProgressPercent(p);return <li className={styles.card} key={record.id} data-media-state={p.state}>
    <div className={styles.kind}><Icon size={16} aria-hidden="true"/>{mediaKindLabels[p.mediaKind]}</div>
    <button type="button" className={styles.open} aria-label={`打开作品：${record.fields.title}`} onClick={()=>onOpenRecord(record.id)}>{record.fields.title}</button>
    {p.creators.length>0&&<p className={styles.creators}>{p.creators.join(' / ')}</p>}
    {progress&&<p className={styles.progressText}>{progress}</p>}{percent!==null&&<progress className={styles.progress} aria-label={`${record.fields.title}进度`} max={100} value={percent}/>}
    {p.rating!==null&&<p className={styles.rating}>个人评分 {p.rating} / 10</p>}
    {p.finishedOn&&<p className={styles.date}>完成于 {p.finishedOn}</p>}
    {onMoveRecord&&<label className={styles.move}>更新状态<select aria-label={`${record.fields.title}的状态`} disabled={disabled} value={p.state} onChange={event=>onMoveRecord(record.id,event.target.value as MediaState)}>{mediaStates.map(state=><option key={state} value={state}>{mediaStateLabels[state]}</option>)}</select></label>}
   </li>;})}</ul>}
  </section>)}</div>}
 </section>;
}
