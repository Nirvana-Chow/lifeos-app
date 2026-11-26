'use client';
import {useCallback,useRef} from 'react';
import {PrivacyBoundary} from '../personal-candidate/privacy';
import {useActiveContentGuard} from '../personal-candidate/workspace-route-context';
import {LifeOSWorkspace} from '../ui-review/workspace';
import {PersonalFinanceWorkbench} from './workbench';

export function PersonalFinancePage({protect=false}:{protect?:boolean}={}){
 const guard=useRef<(()=>boolean)|null>(null);
 const mayLeave=useCallback(()=>guard.current?.()!==false,[]);
 const hosted=useActiveContentGuard(mayLeave);
 const content=<PersonalFinanceWorkbench navigationGuard={guard}/>;
 if(hosted)return content;
 const standalone=<LifeOSWorkspace desktopNavigation
  state={{status:'unknown'}}
  access={{authenticated:true,writable:null,loginAllowed:true}}
  contentPage={{wide:true,title:'财务',content}}
  onBeforeNavigate={mayLeave}
 />;
 return protect?<PrivacyBoundary>{standalone}</PrivacyBoundary>:standalone;
}
