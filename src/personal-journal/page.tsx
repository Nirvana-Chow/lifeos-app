'use client';
import Link from 'next/link';
import {useContext,useRef} from 'react';
import {WorkspaceRouteContext} from '../personal-candidate/workspace-route-context';
import {PrivacyBoundary} from '../personal-candidate/privacy';
import {LifeOSWorkspace} from '../ui-review/workspace';
import {PersonalRecordWorkbench} from '../personal-candidate/record-workbench';
import {JournalHistoryPanel} from './history-panel';
import s from './history.module.css';

/** Compose the journal-only read projection around the existing authoritative editor. */
export function JournalRecordPage({protect=false}:{protect?:boolean}={}){
 const route=useContext(WorkspaceRouteContext),localGuard=useRef<(()=>boolean)|null>(null);
 const guard=route?.journalGuard??localGuard;
 const mayLeave=()=>guard.current?.()!==false;
 const content=<div className={s.page}>
  <JournalHistoryPanel onBeforeOpen={mayLeave} renderEditor={(onSaved,journalDay)=><PersonalRecordWorkbench type="journal" navigationGuard={guard} writeJournal journalDay={journalDay} onJournalSaved={onSaved}/>} activityLink={<Link href="/personal/activity" onNavigate={event=>{if(!mayLeave())event.preventDefault();}}>查看每日活动 · 记录与开发</Link>}/>
 </div>;
 if(route)return content;
 const legacy=<LifeOSWorkspace desktopNavigation state={{status:'unknown'}} access={{authenticated:true,writable:null,loginAllowed:true}} contentPage={{wide:true,title:'记录',content}} onBeforeNavigate={mayLeave}/>;
 return protect?<PrivacyBoundary>{legacy}</PrivacyBoundary>:legacy;
}
