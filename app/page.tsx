import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {readPlatformPagePrincipal,readPlatformLoginCapability} from '../src/platform/runtime';
import {LoginPage} from '../src/personal-candidate/login';
export const dynamic='force-dynamic';
export const metadata={title:'LifeOS',robots:{index:false,follow:false}};
export default async function Page(){
 let principal=null;try{principal=await readPlatformPagePrincipal(await headers());}catch{}
 const capability=await readPlatformLoginCapability();
 if(principal)redirect(capability.mode==='synthetic'?'/review/admin':'/personal');
 return <LoginPage capability={capability}/>;
}
