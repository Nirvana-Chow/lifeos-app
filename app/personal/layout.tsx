import type {ReactNode} from 'react';
import {readPlatformLoginCapability} from '../../src/platform/runtime';
import {DeviceSessionGuard} from '../../src/session-duration/guard';
import {workspaceLayoutInitializationScript} from '../../src/workbench/workspace-layout';
import {WorkspaceViewport} from '../../src/workbench/workspace-viewport';

export default async function Layout({children}: {children: ReactNode}) {
  const capability = await readPlatformLoginCapability();
  return <>
    <script dangerouslySetInnerHTML={{__html: workspaceLayoutInitializationScript}}/>
    <WorkspaceViewport/>
    {capability.sessionDuration ? <DeviceSessionGuard>{children}</DeviceSessionGuard> : children}
  </>;
}
