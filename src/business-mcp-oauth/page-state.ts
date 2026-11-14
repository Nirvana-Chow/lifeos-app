import {verifyOAuthQueryParams} from '@better-auth/oauth-provider';
import {getPlatformBusinessOAuthContext} from '../platform/runtime.ts';
import {readOAuthOwnerState} from './owner-state.ts';
import {oauthQueryFromSearch,readSignedOAuthQuery} from './query.ts';
export async function readOAuthPageState(headers:Headers,search:Record<string,string|string[]|undefined>){
 try{
  const context=await getPlatformBusinessOAuthContext();if(!context)return null;
  const query=await readSignedOAuthQuery(oauthQueryFromSearch(search),context.config,value=>verifyOAuthQueryParams(value,context.platform.secret));if(!query)return null;
  const owner=await readOAuthOwnerState(context.readAuth,context.platform,headers);
  return{...query,config:context.config,owner};
 }catch{return null;}
}
