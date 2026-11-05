import {readVerifiedOwnerSession, type PlatformAuth} from '../platform/auth.ts';
import type {PlatformConfig} from '../platform/config.ts';
import {AuthorityService} from './service.ts';

/** Construct only within the verified personal runtime; no session value is an HTTP DTO. */
export function createOwnerAuthority(auth:PlatformAuth, config:PlatformConfig, binding:Readonly<{ownerId:string;spaceId:string}>,readCurrentAgent?:ConstructorParameters<typeof AuthorityService>[0]['readCurrentAgent']) {
  return new AuthorityService({ownerId:binding.ownerId,spaceId:binding.spaceId,verifyAgent:async()=>null,readCurrentAgent,
    verifyOwner:async headers => {
      const session = await readVerifiedOwnerSession(auth,config,headers);
      return session ? {ownerId:session.principal.userId,spaceId:binding.spaceId,sessionRef:session.sessionRef} : null;
    }});
}
