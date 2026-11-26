'use client';
import {useCallback,useRef,type ReactNode,type RefObject} from 'react';
import {LifeOSWorkspace} from '../ui-review/workspace';
import {PrivacyBoundary} from './privacy';
import {PersonalRecordWorkbench} from './record-workbench';
import {recordModuleLabels,type CareerSection} from './record-modules';
import type {RecordModule} from './record-model';
import {useActiveContentGuard} from './workspace-route-context';

type RecordPageProps={type:RecordModule;linkedPersonId?:string;careerSection?:CareerSection};
type NavigationGuard=RefObject<(()=>boolean)|null>;
type HostedBusinessRecordProps=
 | {type:'career';careerSection:'career'|'resume'}
 | {type:'media'|'portfolio';careerSection?:never};

function useRecordNavigation(){
 const guard=useRef<(()=>boolean)|null>(null);
 const mayLeave=useCallback(()=>guard.current?.()!==false,[]);
 return {guard,mayLeave};
}

function RecordContent({type,careerSection,linkedPersonId,guard}:RecordPageProps&{guard:NavigationGuard}){
 return <PersonalRecordWorkbench type={type} linkedPersonId={linkedPersonId}
  careerSection={careerSection} navigationGuard={guard}/>;
}

function StandaloneRecordPage({content,title,mayLeave}:{
 content:ReactNode;title:string;mayLeave:()=>boolean;
}){
 return <LifeOSWorkspace desktopNavigation state={{status:'unknown'}}
  access={{authenticated:true,writable:null,loginAllowed:true}}
  contentPage={{wide:true,title,content}} onBeforeNavigate={mayLeave}/>;
}

export function PersonalRecordPage(props:RecordPageProps){
 const {guard,mayLeave}=useRecordNavigation();
 return <StandaloneRecordPage content={<RecordContent {...props} guard={guard}/>}
  title={recordModuleLabels[props.careerSection??props.type]} mayLeave={mayLeave}/>;
}

export function HostedBusinessRecordPage(props:HostedBusinessRecordProps){
 const {guard,mayLeave}=useRecordNavigation();
 const hosted=useActiveContentGuard(mayLeave);
 const content=<RecordContent key={props.careerSection??props.type} {...props} guard={guard}/>;
 if(hosted)return content;
 return <PrivacyBoundary><StandaloneRecordPage content={content}
  title={recordModuleLabels[props.careerSection??props.type]} mayLeave={mayLeave}/></PrivacyBoundary>;
}
