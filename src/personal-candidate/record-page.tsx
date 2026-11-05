'use client';
import {useRef} from 'react';
import {LifeOSWorkspace} from '../ui-review/workspace';
import {PersonalRecordWorkbench} from './record-workbench';
import {recordModuleLabels} from './record-modules';
import type {RecordModule} from './record-model';
export function PersonalRecordPage({type}:{type:RecordModule}){const guard=useRef<(()=>boolean)|null>(null);return <LifeOSWorkspace state={{status:'unknown'}} access={{authenticated:true,writable:null,loginAllowed:true}} contentPage={{wide:true,title:recordModuleLabels[type],content:<PersonalRecordWorkbench type={type} navigationGuard={guard}/>}} onBeforeNavigate={()=>guard.current?.()!==false}/>;}
