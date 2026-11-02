import {LoginPage} from '../../src/personal-candidate/login';
import {readPlatformLoginCapability} from '../../src/platform/runtime';
export const dynamic='force-dynamic';
export default async function Page(){return <LoginPage capability={await readPlatformLoginCapability()}/>;}
