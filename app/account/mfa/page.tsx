import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {readPlatformMfaState} from '../../../src/platform/runtime';
import {OwnerMfaPanel} from '../../../src/personal-candidate/owner-mfa-panel';
import {readOAuthPageState} from '../../../src/business-mcp-oauth/page-state';
export const dynamic='force-dynamic';
export const metadata={title:'LifeOS · 两步验证',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const currentHeaders=await headers(),search=await searchParams,oauth=Object.keys(search).length?await readOAuthPageState(currentHeaders,search):null;
 const state=await readPlatformMfaState(currentHeaders),suffix=oauth?'?oauth_query='+encodeURIComponent(oauth.query):'';
 if(state.kind==='anonymous')redirect('/login'+suffix);
 if(state.kind==='ready')redirect(oauth?'/personal/oauth/continue'+suffix:'/personal');
 const mode=state.kind==='enroll'?state.step:state.kind;
 return <OwnerMfaPanel mode={mode} oauthQuery={oauth?.query}/>;
}
