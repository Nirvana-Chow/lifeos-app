import {headers} from 'next/headers';import {redirect} from 'next/navigation';
import {readOAuthPageState} from '../../../src/business-mcp-oauth/page-state';
import {OAuthPanel} from '../../../src/business-mcp-oauth/panel';
export const dynamic='force-dynamic';export const metadata={title:'LifeOS · 业务连接',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const state=await readOAuthPageState(await headers(),await searchParams);
 if(!state)return <main><h1>连接暂不可用</h1><p>请返回 ChatGPT 重新发起 LifeOS 连接。</p></main>;
 if(state.owner==='reauthenticate')redirect('/login?reauthenticate=1&oauth_query='+encodeURIComponent(state.query));
 if(state.owner!=='ready')redirect((state.owner==='anonymous'?'/login':'/account/mfa')+'?oauth_query='+encodeURIComponent(state.query));
 return <OAuthPanel {...state}/>;
}
