import {OwnerRecoveryFinishPanel} from '../../../src/personal-candidate/owner-recovery-finish-panel';
import {readPlatformRecoveryCapability} from '../../../src/platform/runtime';
export const dynamic='force-dynamic';
export default async function Page(){const capability=await readPlatformRecoveryCapability();return <OwnerRecoveryFinishPanel enabled={capability.enabled} ownerAlias={capability.ownerAlias}/>;}
