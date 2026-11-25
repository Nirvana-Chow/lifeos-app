import {lifeOSInstallMetadata} from '../../src/ui-review/install-metadata';
import type {ReactNode} from 'react';
import {readPlatformLoginCapability} from '../../src/platform/runtime';
import {DeviceSessionGuard} from '../../src/session-duration/guard';
import {workspaceLayoutInitializationScript} from '../../src/workbench/workspace-layout';
import {WorkspaceViewport} from '../../src/workbench/workspace-viewport';

export const metadata=lifeOSInstallMetadata;

export default async function Layout({children}: {children: ReactNode}) {
  const capability = await readPlatformLoginCapability();
  return <>
    <script dangerouslySetInnerHTML={{__html: workspaceLayoutInitializationScript}}/>
    <WorkspaceViewport/>
    <DeviceSessionGuard capability={capability}>{children}</DeviceSessionGuard>
  </>;
}
