import {safeSessionReturn} from '../../src/session-duration/client';
import {LoginPage} from '../../src/personal-candidate/login';
import {readPlatformLoginCapability,readPlatformPagePrincipal} from '../../src/platform/runtime';
import {headers} from 'next/headers';import {redirect} from 'next/navigation';
import {readOAuthPageState} from '../../src/business-mcp-oauth/page-state';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const search=await searchParams,state=Object.keys(search).length?await readOAuthPageState(await headers(),search):null;
 if(search.reauthenticate!=='1'&&state?.owner==='ready')redirect('/personal/oauth/continue?oauth_query='+encodeURIComponent(state.query));
 const returnTo=typeof search.return_to==='string'?safeSessionReturn(search.return_to):undefined;if(search.reauthenticate!=='1'&&!state){let owner=null;try{owner=await readPlatformPagePrincipal(await headers());}catch{}if(owner)redirect(returnTo??'/personal');}
 return <LoginPage capability={await readPlatformLoginCapability()} oauthQuery={state?.query} returnTo={returnTo}/>;
}
