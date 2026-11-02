import{headers}from'next/headers';import{redirect}from'next/navigation';
import{readPlatformPagePrincipal}from'../../src/platform/runtime';
import{LivePersonalWorkspace}from'../../src/personal-candidate/live-workspace';
export const dynamic='force-dynamic';
export const metadata={title:'LifeOS · 本人空间',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{page?:string;create?:string}>}){let principal=null;try{principal=await readPlatformPagePrincipal(await headers());}catch{}if(!principal)redirect('/login');const q=await searchParams;return <LivePersonalWorkspace initialPage={q.page==='tasks'?'tasks':'overview'} initialCreateTask={q.create==='todo'}/>;}
