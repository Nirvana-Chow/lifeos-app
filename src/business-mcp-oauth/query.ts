import type {BusinessOAuthConfig} from './boundary.ts';
export type SignedOAuthQuery=Readonly<{query:string;clientId:string;scopes:readonly string[]}>;
export async function readSignedOAuthQuery(query:string,config:BusinessOAuthConfig,verify:(query:string)=>Promise<boolean>):Promise<SignedOAuthQuery|null>{
 if(!query||query.length>8192||!await verify(query))return null;
 const params=new URLSearchParams(query);
 // The fixed provider repeats ba_param to sign its parameter-name manifest.
 // Protocol inputs (including resource/client/scope/sig) remain single-valued.
 for(const key of new Set(params.keys()))if(key!=='ba_param'&&params.getAll(key).length!==1)return null;
 if(params.getAll('ba_param').length>40)return null;
 const clientId=params.get('client_id'),redirect=params.get('redirect_uri'),scope=params.get('scope');
 if(!clientId||!redirect||!scope||params.get('resource')!==config.resource||params.get('code_challenge_method')!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(params.get('code_challenge')??''))return null;
 try{for(const value of [clientId,redirect]){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.hash)return null;}}catch{return null;}
 const scopes=scope.split(' ');if(new Set(scopes).size!==scopes.length||scopes.some(value=>!config.scopes.includes(value)))return null;
 return{query,clientId,scopes};
}
export function oauthQueryFromSearch(search:Record<string,string|string[]|undefined>):string{
 if(typeof search.oauth_query==='string'&&Object.keys(search).length===1)return search.oauth_query;
 const query=new URLSearchParams();for(const[key,value]of Object.entries(search)){if(Array.isArray(value))for(const item of value)query.append(key,item);else if(value!==undefined)query.append(key,value);}return query.toString();
}
/** Redirect authority comes from the provider's signed request, never the response alone. */
export function validOAuthRedirect(destination:string,query:string,config:BusinessOAuthConfig):boolean{
 try{
  const origin=new URL(config.resource).origin,url=new URL(destination,origin);
  if(url.origin===origin&&['/personal/oauth','/personal/oauth/continue','/login'].includes(url.pathname)&&!url.username&&!url.password&&!url.hash)return true;
  const callback=new URL(new URLSearchParams(query).get('redirect_uri')??'');
  return url.origin===callback.origin&&url.pathname===callback.pathname&&!url.username&&!url.password&&!url.hash&&url.searchParams.get('iss')===config.issuer&&[...callback.searchParams].every(([key,value])=>url.searchParams.get(key)===value);
 }catch{return false;}
}
