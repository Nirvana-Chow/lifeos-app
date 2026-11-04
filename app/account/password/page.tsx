import{headers}from'next/headers';
import{redirect}from'next/navigation';
import{readPlatformPagePrincipal,readPlatformPasswordCapability}from'../../../src/platform/runtime';
import{PasswordPage}from'../../../src/personal-candidate/password-page';
import {PersonalPage} from '../../../src/personal-candidate/personal-page';
export const dynamic='force-dynamic';
export const metadata={title:'LifeOS · 修改本人密码',robots:{index:false,follow:false}};
export default async function Page(){let owner=null;try{owner=await readPlatformPagePrincipal(await headers());}catch{}if(!owner)redirect('/login');return <PersonalPage title="修改密码"><PasswordPage enabled={await readPlatformPasswordCapability()} changeOnly embedded/></PersonalPage>;}
