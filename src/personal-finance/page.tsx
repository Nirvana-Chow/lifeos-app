'use client';
import {useContext,useRef} from 'react';
import {PrivacyBoundary} from '../personal-candidate/privacy';
import {WorkspaceRouteContext} from '../personal-candidate/workspace-route-context';
import {LifeOSWorkspace} from '../ui-review/workspace';
import {PersonalFinanceWorkbench} from './workbench';

export function PersonalFinancePage({protect=false}:{protect?:boolean}={}){
 const route=useContext(WorkspaceRouteContext);
 const localGuard=useRef<(()=>boolean)|null>(null);
 const guard=route?.activeContentGuard??localGuard;
 const content=<PersonalFinanceWorkbench navigationGuard={guard}/>;
 if(route)return content;
 const standalone=<LifeOSWorkspace desktopNavigation
  state={{status:'unknown'}}
  access={{authenticated:true,writable:null,loginAllowed:true}}
  contentPage={{wide:true,title:'财务',content}}
  onBeforeNavigate={()=>guard.current?.()!==false}
 />;
 return protect?<PrivacyBoundary>{standalone}</PrivacyBoundary>:standalone;
}
