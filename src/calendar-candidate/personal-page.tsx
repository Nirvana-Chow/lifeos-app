'use client';
import {useRef} from 'react';
import {LifeOSWorkspace} from '../ui-review/workspace';
import {PersonalCalendarWorkbench} from './personal-workbench';
export function PersonalCalendarPage(){const guard=useRef<(()=>boolean)|null>(null);return<LifeOSWorkspace state={{status:'unknown'}} access={{authenticated:true,writable:null,loginAllowed:true}} contentPage={{wide:true,title:'日程',content:<PersonalCalendarWorkbench navigationGuard={guard}/>}} onBeforeNavigate={()=>guard.current?.()!==false}/>;}
