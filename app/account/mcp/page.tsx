import {headers} from 'next/headers';import {redirect} from 'next/navigation';
import {readPlatformMfaState} from '../../../src/platform/runtime';
import {handleManagedClientRequest} from '../../../src/business-mcp-oauth/managed-client-runtime';
import {managedClientPath,readManagedClientSetup} from '../../../src/business-mcp-oauth/managed-client-contract';
import {ManagedClientPanel} from '../../../src/business-mcp-oauth/managed-client-panel';
export const dynamic='force-dynamic';
export const metadata={title:'LifeOS · ChatGPT 连接设置',robots:{index:false,follow:false}};
export default async function Page(){
 const incoming=await headers(),owner=await readPlatformMfaState(incoming);
 if(owner.kind==='anonymous')redirect('/login');if(owner.kind!=='ready')redirect('/account/mfa');
 const response=await handleManagedClientRequest(new Request('https://lifeos.nirvanachow.com'+managedClientPath,{headers:incoming}));
 const value=response.ok?readManagedClientSetup((await response.json()).configuration):null;
 return <ManagedClientPanel initial={value} initialConflict={response.status===409}/>;
}
