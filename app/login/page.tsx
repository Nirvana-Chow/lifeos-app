import {LoginPage} from '../../src/personal-candidate/login';
import {readPlatformLoginCapability} from '../../src/platform/runtime';
import {headers} from 'next/headers';import {redirect} from 'next/navigation';
import {readOAuthPageState} from '../../src/business-mcp-oauth/page-state';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const search=await searchParams,state=Object.keys(search).length?await readOAuthPageState(await headers(),search):null;
 if(state?.owner==='ready')redirect('/personal/oauth/continue?oauth_query='+encodeURIComponent(state.query));
 return <LoginPage capability={await readPlatformLoginCapability()} oauthQuery={state?.query}/>;
}
