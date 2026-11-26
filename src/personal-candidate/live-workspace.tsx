'use client';
import {useContext,useLayoutEffect,useRef} from 'react';
import type {SettingsPanel,WorkspacePage} from '../ui-review/contract';
import {WorkspaceRouteContext,type TaskShellFrame} from './workspace-route-context';
import {LifeOSWorkspace} from '../ui-review/workspace';
import {ConnectedPersonalWorkspace} from './connected-workspace';
import {AccountApiKeys} from './account-api-keys';
import {ClassificationReview} from './classification-review';
import {TaskClassificationPreview} from './task-classification-preview';
import {DeviceSessionsSettings} from '../session-duration/settings';
import {PasswordPage} from './password-page';
type WorkspaceOptions={showApiKeys?:boolean;passwordEnabled?:boolean};
type LiveOptions=WorkspaceOptions&{initialPage?:WorkspacePage;initialModal?:'settings'|'classification';initialSettingsPanel?:SettingsPanel;initialClassificationPlanId?:string;initialTaskId?:string;initialCreateTask?:boolean};

export function PersonalWorkspaceView({showApiKeys=false,passwordEnabled=false,...props}:TaskShellFrame){
 const classificationCloseGuard=useRef<(()=>boolean)|null>(null);
 const settingsCloseGuard=useRef<(()=>boolean)|null>(null);
 return <LifeOSWorkspace desktopNavigation {...props} renderTaskClassificationPreview={()=> <TaskClassificationPreview embedded/>} syncUrl
  classificationCloseGuard={classificationCloseGuard}
  renderClassification={(planId,onClose,onPlanChange,container)=><ClassificationReview key={planId} {...{planId,onClose,onPlanChange,container}} closeGuard={classificationCloseGuard}/>} settingsCloseGuard={settingsCloseGuard}
  availableSettingsPanels={showApiKeys?['security','api-keys']:['security']}
  renderSettingsPanel={panel=>panel==='security'?<><h2>安全与密码</h2><PasswordPage enabled={passwordEnabled} changeOnly embedded closeGuard={settingsCloseGuard}/><DeviceSessionsSettings/></>:
   panel==='api-keys'&&showApiKeys?<><h2>API 密钥</h2><AccountApiKeys embedded closeGuard={settingsCloseGuard}/></>:<p role="status">此设置尚未启用。</p>}/>;
}

function PublishTaskFrame({publish,frame}:{publish:(frame:TaskShellFrame|null)=>void;frame:TaskShellFrame}){
 useLayoutEffect(()=>{publish(frame);},[publish,frame]);
 useLayoutEffect(()=>()=>publish(null),[publish]);
 return null;
}

export function LivePersonalWorkspace({initialTaskId,initialCreateTask,...options}:LiveOptions){
 const route=useContext(WorkspaceRouteContext);
 return <ConnectedPersonalWorkspace initialTaskId={initialTaskId} initialCreateTask={initialCreateTask}>
  {props=>route?<PublishTaskFrame publish={route.publishTaskFrame} frame={{...props,...options}}/>:
   <PersonalWorkspaceView {...props} {...options}/>}
 </ConnectedPersonalWorkspace>;
}
