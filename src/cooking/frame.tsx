'use client';

import type {ReactNode} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ArrowLeft} from 'lucide-react';
import {PrivacyBoundary} from '../personal-candidate/privacy';
import {LifeOSWorkspace} from '../ui-review/workspace';
import {workspaceHref} from '../workbench/private-navigation';
import styles from './workspace.module.css';

export function CookingFrame({title,children,canNavigate}:{title:string;children:ReactNode;canNavigate?:()=>boolean}){
 const router=useRouter();
 return <LifeOSWorkspace state={{status:'unknown'}}
  access={{authenticated:true,writable:null,loginAllowed:true}}
  initialPage="overview"
  contentPage={{title,wide:true,content:<PrivacyBoundary>
   <Link href="/personal" className={styles.backLink}><ArrowLeft aria-hidden="true" size={17}/>返回工作台</Link>
   {children}
  </PrivacyBoundary>}}
  onNavigatePage={page=>router.push(workspaceHref(page))}
  onBeforeNavigate={canNavigate}
 />;
}
