import {lifeOSInstallMetadata} from '../../src/ui-review/install-metadata';
import type {ReactNode} from 'react';
import {headers} from 'next/headers';
import {PersistentPersonalWorkspace} from '../../src/personal-candidate/persistent-workspace';
import {readPlatformLoginCapability,readPlatformPagePrincipal} from '../../src/platform/runtime';
import {DeviceSessionGuard} from '../../src/session-duration/guard';
import {workspaceLayoutInitializationScript} from '../../src/workbench/workspace-layout';
import {WorkspaceViewport} from '../../src/workbench/workspace-viewport';

export const metadata=lifeOSInstallMetadata;

export default async function Layout({children}: {children: ReactNode}) {
  const capability = await readPlatformLoginCapability();
  const principal=await readPlatformPagePrincipal(await headers()).catch(()=>null);
  const content=principal?<PersistentPersonalWorkspace>{children}</PersistentPersonalWorkspace>:children;
  return <>
    <script dangerouslySetInnerHTML={{__html: workspaceLayoutInitializationScript}}/>
    <WorkspaceViewport/>
    {capability.sessionDuration ? <DeviceSessionGuard>{content}</DeviceSessionGuard> : content}
  </>;
}
