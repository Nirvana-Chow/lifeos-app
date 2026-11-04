import {keyManagementFlag} from '../../../src/agent-api/key-management-config';
import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {readPlatformPagePrincipal} from '../../../src/platform/runtime';
import {LivePersonalWorkspace} from '../../../src/personal-candidate/live-workspace';
import {PersonalWorkspace} from '../../../src/personal-candidate/workspace';
import type {PersonalType} from '../../../src/personal-candidate/config';
import {validateId} from '../../../src/platform/domain';

export const dynamic='force-dynamic';
export const metadata={title:'LifeOS · 工作台',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{type?:string;id?:string}>}){
 let principal=null;
 try{principal=await readPlatformPagePrincipal(await headers());}catch{}
 if(!principal)redirect('/login');
 const q=await searchParams;
 const type=['todo','journal','project','domain','topic'].includes(q.type??'')?q.type as PersonalType:'todo';
 if(type==='todo')return <LivePersonalWorkspace showApiKeys={process.env[keyManagementFlag]==='1'} initialPage="tasks" initialTaskId={q.id} initialCreateTask={q.id===undefined}/>;
 let id:string|undefined;
 try{if(q.id)id=validateId(q.id);}catch{}
 return <PersonalWorkspace initialType={type} initialId={id} returnHref="/personal" focused/>;
}
