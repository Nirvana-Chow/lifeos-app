import type {ReactNode} from 'react';
import {readPlatformLoginCapability} from '../../src/platform/runtime';
import {DeviceSessionGuard} from '../../src/session-duration/guard';
export default async function Layout({children}:{children:ReactNode}){const capability=await readPlatformLoginCapability();return capability.sessionDuration?<DeviceSessionGuard>{children}</DeviceSessionGuard>:children;}
