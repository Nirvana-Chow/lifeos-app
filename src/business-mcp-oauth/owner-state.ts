import {readOwnerMfaState,readVerifiedOwnerSession,type PlatformAuth,type OwnerMfaState} from '../platform/auth.ts';
import type {PlatformConfig} from '../platform/config.ts';

/** Viewing ordinary owner data and approving a connection have different freshness requirements. */
export async function readOAuthOwnerState(auth:PlatformAuth,config:PlatformConfig,headers:Headers):Promise<OwnerMfaState['kind']|'reauthenticate'>{
 const state=await readOwnerMfaState(auth,config,headers);
 if(state.kind!=='ready')return state.kind;
 return await readVerifiedOwnerSession(auth,config,headers)?'ready':'reauthenticate';
}
