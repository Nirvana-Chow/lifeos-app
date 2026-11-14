'use client';
import {useRef} from 'react';
import type {SettingsPanel, WorkspacePage} from '../ui-review/contract';
import {LifeOSWorkspace} from '../ui-review/workspace';
import {ConnectedPersonalWorkspace} from './connected-workspace';
import {AccountApiKeys} from './account-api-keys';
import {ClassificationReview} from './classification-review';
import {DeviceSessionsSettings} from '../session-duration/settings';
import {PasswordPage} from './password-page';
export function LivePersonalWorkspace({initialPage='overview',initialModal,initialSettingsPanel,initialClassificationPlanId,initialTaskId,initialCreateTask=false,showApiKeys=false,passwordEnabled=false}:{initialPage?:WorkspacePage;initialModal?:'settings'|'classification';initialClassificationPlanId?:string;initialSettingsPanel?:SettingsPanel;initialTaskId?:string;initialCreateTask?:boolean;showApiKeys?:boolean;passwordEnabled?:boolean}){
 const classificationCloseGuard=useRef<(()=>boolean)|null>(null);
 const settingsCloseGuard=useRef<(()=>boolean)|null>(null);
 return <ConnectedPersonalWorkspace initialTaskId={initialTaskId} initialCreateTask={initialCreateTask}>{props=><LifeOSWorkspace {...props} syncUrl initialPage={initialPage}
  initialModal={initialModal} initialSettingsPanel={initialSettingsPanel} initialClassificationPlanId={initialClassificationPlanId} classificationCloseGuard={classificationCloseGuard}
  renderClassification={(planId,onClose,onPlanChange,container)=><ClassificationReview key={planId} {...{planId,onClose,onPlanChange,container}} closeGuard={classificationCloseGuard}/>} settingsCloseGuard={settingsCloseGuard}
  availableSettingsPanels={showApiKeys?['security','api-keys']:['security']}
  renderSettingsPanel={panel=>panel==='security'?<><h2>安全与密码</h2><PasswordPage enabled={passwordEnabled} changeOnly embedded closeGuard={settingsCloseGuard}/><DeviceSessionsSettings/></>:
   panel==='api-keys'&&showApiKeys?<><h2>API 密钥</h2><AccountApiKeys embedded closeGuard={settingsCloseGuard}/></>:<p role="status">此设置尚未启用。</p>}/>}</ConnectedPersonalWorkspace>;
}
