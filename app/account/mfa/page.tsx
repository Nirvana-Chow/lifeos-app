import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {readPlatformMfaState} from '../../../src/platform/runtime';
import {OwnerMfaPanel} from '../../../src/personal-candidate/owner-mfa-panel';
export const dynamic='force-dynamic';
export const metadata={title:'LifeOS · 两步验证',robots:{index:false,follow:false}};
export default async function Page(){
 const state=await readPlatformMfaState(await headers());
 if(state.kind==='anonymous')redirect('/login');
 if(state.kind==='ready')redirect('/personal');
 const mode=state.kind==='enroll'?state.step:state.kind;
 return <OwnerMfaPanel mode={mode}/>;
}
