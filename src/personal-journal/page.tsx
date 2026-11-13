'use client';
import {useRef} from 'react';
import {LifeOSWorkspace} from '../ui-review/workspace';
import {PersonalRecordWorkbench} from '../personal-candidate/record-workbench';
import {JournalHistoryPanel} from './history-panel';
import s from './history.module.css';

/** Compose the journal-only read projection around the existing authoritative editor. */
export function JournalRecordPage(){
 const guard=useRef<(()=>boolean)|null>(null);
 const mayLeave=()=>guard.current?.()!==false;
 return <LifeOSWorkspace state={{status:'unknown'}} access={{authenticated:true,writable:null,loginAllowed:true}} contentPage={{wide:true,title:'日记',content:<div className={s.page}><JournalHistoryPanel onBeforeOpen={mayLeave}/><PersonalRecordWorkbench type="journal" navigationGuard={guard}/></div>}} onBeforeNavigate={mayLeave}/>;
}
