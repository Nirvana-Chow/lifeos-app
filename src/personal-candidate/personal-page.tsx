'use client';

import type {ReactNode} from 'react';
import {useRouter} from 'next/navigation';
import {LifeOSWorkspace} from '../ui-review/workspace';
import {workspaceHref} from '../workbench/private-navigation';
import {PrivacyBoundary} from './privacy';
import type {WorkspacePage} from '../ui-review/contract';

/** Account content shares the workspace chrome without loading Todo records. */
export function PersonalPage({title,children,initialPage='settings',canNavigate,wide}: {title:string;children:ReactNode;initialPage?:WorkspacePage;canNavigate?:()=>boolean;wide?:boolean}) {
 const router=useRouter();
 return <LifeOSWorkspace
  state={{status:'unknown'}}
  access={{authenticated:true,writable:null,loginAllowed:true}}
  initialPage={initialPage}
  contentPage={{title,wide,content:<PrivacyBoundary>{children}</PrivacyBoundary>}}
  onNavigatePage={page=>{if(!canNavigate||canNavigate())router.push(workspaceHref(page));}}
 />;
}
