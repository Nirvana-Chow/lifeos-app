'use client';

import type {ReactNode} from 'react';
import {useRouter} from 'next/navigation';
import {LifeOSWorkspace} from '../ui-review/workspace';
import {workspaceHref} from '../workbench/private-navigation';
import {PrivacyBoundary} from './privacy';

/** Account content shares the workspace chrome without loading Todo records. */
export function PersonalPage({title, children}: {title: string; children: ReactNode}) {
 const router=useRouter();
 return <LifeOSWorkspace
  state={{status:'unknown'}}
  access={{authenticated:true,writable:null,loginAllowed:true}}
  initialPage="settings"
  contentPage={{title,content:<PrivacyBoundary>{children}</PrivacyBoundary>}}
  onNavigatePage={page=>router.push(workspaceHref(page))}
 />;
}
