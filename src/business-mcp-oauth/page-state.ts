import {verifyOAuthQueryParams} from '@better-auth/oauth-provider';
import {getPlatformBusinessOAuthContext} from '../platform/runtime.ts';
import {readOwnerMfaState} from '../platform/auth.ts';
import {oauthQueryFromSearch,readSignedOAuthQuery} from './query.ts';
export async function readOAuthPageState(headers:Headers,search:Record<string,string|string[]|undefined>){
 try{
  const context=await getPlatformBusinessOAuthContext();if(!context)return null;
  const query=await readSignedOAuthQuery(oauthQueryFromSearch(search),context.config,value=>verifyOAuthQueryParams(value,context.platform.secret));if(!query)return null;
  const owner=await readOwnerMfaState(context.readAuth,context.platform,headers);
  return{...query,config:context.config,owner:owner.kind};
 }catch{return null;}
}
