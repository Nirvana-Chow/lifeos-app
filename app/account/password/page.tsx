import{headers}from'next/headers';
import{redirect}from'next/navigation';
import{readPlatformPagePrincipal}from'../../../src/platform/runtime';
export const dynamic='force-dynamic';
export const metadata={title:'LifeOS · 修改本人密码',robots:{index:false,follow:false}};
export default async function Page(){let owner=null;try{owner=await readPlatformPagePrincipal(await headers());}catch{}if(!owner)redirect('/login');redirect('/personal?modal=settings&panel=security');}
