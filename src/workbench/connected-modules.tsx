'use client';
import {PersonalWorkspace} from '../personal-candidate/workspace';
import{BasicWorkspace}from'./draft-workspace';
import{RecordWindowWorkbench}from'../record-window-workbench';
import {useState} from 'react';
import Link from'next/link';import{Card,CardContent,CardHeader,CardTitle}from'../../components/ui/card';
import{TasksWorkbench}from'../tasks-workbench';import{JournalPage}from'../journal-candidate/journal';
import{FinanceWorkbench}from'../finance-workbench';import{RecordWorkbench}from'../records-workbench';
import{CalendarCandidatePage}from'../calendar-candidate/client';import{useWorkspaceStatus}from'./status';import s from'./styles.module.css';
type Module='records'|'search'|'todos'|'journal'|'schedule'|'finance'|'growth'|'articles'|'knowledge'|'health';
const titles:Record<Module,string>={records:'记录时间线',search:'统一搜索',todos:'待办',journal:'日志与心情',schedule:'日程',finance:'财务',growth:'学习与职业',articles:'文章与收藏',knowledge:'资料索引',health:'运动健康'};
function JournalWorkspace(){const [view,setView]=useState<'journal'|'mood'>('journal'),[locked,setLocked]=useState(false);return <><div className={s.actions} role="group" aria-label="日志分类"><button className={s.buttonSecondary} aria-pressed={view==='journal'} disabled={locked} onClick={()=>setView('journal')}>日记</button><button className={s.buttonSecondary} aria-pressed={view==='mood'} disabled={locked} onClick={()=>setView('mood')}>心情记录</button></div>{view==='journal'?<JournalPage allowSyntheticReview onLockChange={setLocked}/>:<RecordWorkbench allowedTypes={['mood']} access="developer-review" accountState="review-only" loginHref="/review/admin/login" onNavigationLockChange={setLocked}/>}</>;}
export function ConnectedModule({module,syntheticReview=false}:{module:Module;syntheticReview?:boolean}){
 const status=useWorkspaceStatus(),allowed=syntheticReview&&status.state==='review-only'&&status.storageConnected;
 if(status.state==='personal'&&!syntheticReview&&(module==='journal'||module==='growth'||module==='knowledge'))return <PersonalWorkspace initialType={module==='growth'?'project':module==='knowledge'?'domain':'journal'}/>;
 if(allowed){
  if(module==='records')return <><RecordWindowWorkbench mode="timeline"/><section className={s.page} aria-label="分类记录入口"><h2>按类别查看与编辑</h2><div className={s.actions}>{[['journal','日志与心情'],['growth','学习、项目与职业'],['articles','文章与收藏'],['knowledge','资料索引'],['todos','待办'],['finance','财务'],['health','实际训练'],['schedule','日程']].map(([path,label])=><Link className={s.buttonSecondary} key={path} href={'/review/admin/'+path+'?mode=synthetic-review'}>{label}</Link>)}</div></section></>;
  if(module==='search')return <RecordWindowWorkbench mode="search"/>;
  if(module==='todos')return <TasksWorkbench access="developer-review" accountState="review-only" loginHref="/review/admin/login"/>;
  if(module==='journal')return <JournalWorkspace/>;
  if(module==='finance')return <FinanceWorkbench access="developer-review" accountState="review-only" loginHref="/review/admin/login"/>;
  if(module==='growth'||module==='articles'||module==='knowledge'||module==='health')return <RecordWorkbench allowedTypes={module==='health'?['training']:module==='growth'?['learning','project','career']:module==='articles'?['article','resource']:['resource']} access="developer-review" accountState="review-only" loginHref="/review/admin/login"/>;
  return <CalendarCandidatePage access="developer-review" ownerScope="isolated-synthetic-review" storageReady={status.calendarConnected}/>;
 }
 return <BasicWorkspace module={module}/>;
}
