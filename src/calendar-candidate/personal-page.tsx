'use client';
import {useRef} from 'react';
import {LifeOSWorkspace} from '../ui-review/workspace';
import {PersonalCalendarWorkbench} from './personal-workbench';
export function PersonalCalendarPage({linkedRecordId}:{linkedRecordId?:string}){const guard=useRef<(()=>boolean)|null>(null);return<LifeOSWorkspace desktopNavigation state={{status:'unknown'}} access={{authenticated:true,writable:null,loginAllowed:true}} contentPage={{wide:true,title:'日程',content:<PersonalCalendarWorkbench navigationGuard={guard} linkedRecordId={linkedRecordId}/>}} onBeforeNavigate={()=>guard.current?.()!==false}/>;}
