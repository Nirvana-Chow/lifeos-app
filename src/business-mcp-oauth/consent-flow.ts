import type {BusinessOAuthConfig} from './boundary.ts';
import {validOAuthRedirect} from './query.ts';

type Result={kind:'redirect'|'reauthenticate';location:string}|{kind:'unknown'};
/** A transport failure never replays a potentially consumed consent or continuation. */
export async function submitOAuthConsent(input:{query:string;config:BusinessOAuthConfig;continuation:boolean;accept:boolean},send:typeof fetch=fetch):Promise<Result>{
 try{
  const response=await send('/api/platform/auth/oauth2/'+(input.continuation?'continue':'consent'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input.continuation?{postLogin:true,oauth_query:input.query}:{accept:input.accept,oauth_query:input.query})});
  if(response.status===401){
   const value=await response.json();
   if(value?.error==='OWNER_MFA_REQUIRED')return{kind:'reauthenticate',location:'/login?reauthenticate=1&oauth_query='+encodeURIComponent(input.query)};
   return{kind:'unknown'};
  }
  if(!response.ok)return{kind:'unknown'};
  const value=await response.json();
  if(value?.redirect!==true||typeof value.url!=='string'||!validOAuthRedirect(value.url,input.query,input.config))return{kind:'unknown'};
  return{kind:'redirect',location:value.url};
 }catch{return{kind:'unknown'};}
}
