'use client';

import Link from 'next/link';
import {useContext,type ReactNode} from 'react';
import {StorageReviewHostContext} from '../storage-review/workspace-body';
import {WorkspaceRouteContext} from './workspace-route-context';

export function StorageReviewWorkspaceFrame({children}:{children:ReactNode}){
  const host=useContext(WorkspaceRouteContext);
  if(host)return <StorageReviewHostContext.Provider value={host}>{children}</StorageReviewHostContext.Provider>;
  return <main className="mx-auto max-w-6xl p-4 sm:p-6">
    <Link href="/personal/storage-review">返回存储审核独立入口</Link>
    <h1 className="mb-4 text-2xl font-semibold">存储审核</h1>
    {children}
  </main>;
}
