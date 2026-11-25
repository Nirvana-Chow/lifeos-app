'use client';
import Link from 'next/link';
import {useRef} from 'react';
import {LifeOSWorkspace} from '../ui-review/workspace';
import {PersonalRecordWorkbench} from '../personal-candidate/record-workbench';
import {JournalHistoryPanel} from './history-panel';
import s from './history.module.css';

/** Compose the journal-only read projection around the existing authoritative editor. */
export function JournalRecordPage(){
 const guard=useRef<(()=>boolean)|null>(null);
 const mayLeave=()=>guard.current?.()!==false;
 return <LifeOSWorkspace desktopNavigation state={{status:'unknown'}} access={{authenticated:true,writable:null,loginAllowed:true}} contentPage={{wide:true,title:'日记',content:<div className={s.page}><Link href="/personal/activity" onNavigate={event=>{if(!mayLeave())event.preventDefault();}}>查看每日活动</Link><JournalHistoryPanel onBeforeOpen={mayLeave}/><PersonalRecordWorkbench type="journal" navigationGuard={guard}/></div>}} onBeforeNavigate={mayLeave}/>;
}
