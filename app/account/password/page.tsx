import{headers}from'next/headers';
import{redirect}from'next/navigation';
import{readPlatformPagePrincipal,readPlatformPasswordCapability}from'../../../src/platform/runtime';
import{LegacyPasswordEntry}from'../../../src/personal-candidate/legacy-password-entry';
export const dynamic='force-dynamic';
export const metadata={title:'LifeOS · 修改本人密码',robots:{index:false,follow:false}};
export default async function Page(){let owner=null;try{owner=await readPlatformPagePrincipal(await headers());}catch{}if(!owner)redirect('/login');return <LegacyPasswordEntry enabled={await readPlatformPasswordCapability()}/>;}
