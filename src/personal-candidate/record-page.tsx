'use client';
import {useRef} from 'react';
import {LifeOSWorkspace} from '../ui-review/workspace';
import {PersonalRecordWorkbench} from './record-workbench';
import {recordModuleLabels,type CareerSection} from './record-modules';
import type {RecordModule} from './record-model';
export function PersonalRecordPage({type,linkedPersonId,careerSection}:{type:RecordModule;linkedPersonId?:string;careerSection?:CareerSection}){const guard=useRef<(()=>boolean)|null>(null);return <LifeOSWorkspace desktopNavigation state={{status:'unknown'}} access={{authenticated:true,writable:null,loginAllowed:true}} contentPage={{wide:true,title:careerSection?recordModuleLabels[careerSection]:recordModuleLabels[type],content:<PersonalRecordWorkbench type={type} linkedPersonId={linkedPersonId} careerSection={careerSection} navigationGuard={guard}/>}} onBeforeNavigate={()=>guard.current?.()!==false}/>;}
