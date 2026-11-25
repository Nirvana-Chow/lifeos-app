import {lifeOSInstallMetadata} from '../../src/ui-review/install-metadata';
import type {ReactNode} from 'react';
import {readPlatformLoginCapability} from '../../src/platform/runtime';
import {DeviceSessionGuard} from '../../src/session-duration/guard';
export const metadata=lifeOSInstallMetadata;
export default async function Layout({children}:{children:ReactNode}){const capability=await readPlatformLoginCapability();return capability.sessionDuration?<DeviceSessionGuard>{children}</DeviceSessionGuard>:children;}
