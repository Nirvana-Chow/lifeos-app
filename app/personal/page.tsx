import {keyManagementFlag} from '../../src/agent-api/key-management-config';
import{headers}from'next/headers';import{redirect}from'next/navigation';
import{readPlatformPagePrincipal}from'../../src/platform/runtime';
import{LivePersonalWorkspace}from'../../src/personal-candidate/live-workspace';
import{readWorkspacePage}from'../../src/workbench/private-navigation';
export const dynamic='force-dynamic';
export const metadata={title:'LifeOS · 本人空间',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{page?:string;create?:string}>}){let principal=null;try{principal=await readPlatformPagePrincipal(await headers());}catch{}if(!principal)redirect('/login');const q=await searchParams;return <LivePersonalWorkspace showApiKeys={process.env[keyManagementFlag]==='1'} initialPage={readWorkspacePage(q.page)} initialCreateTask={q.create==='todo'}/>;}
