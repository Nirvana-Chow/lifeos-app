import {fail,sha256,type FileHandoffActor} from './contracts.ts';
import {fileHandoffOperations} from './operations.ts';

export * from './permission-contracts.ts';
import {filePermissionSchema,type FilePermission} from './permission-contracts.ts';
export type FileGrant={grantId:string;ownerId:string;spaceId:string;scopes:readonly string[];allowedOperationIds?:readonly string[];fileHandoff?:FilePermission;oauthFence?:unknown};
/** Only the current server SQL reader calls this; request data is never a grant. */
export function extendFileGrant<T extends FileGrant>(base:T,value:unknown,enabled:boolean):T&{fileHandoff?:FilePermission}{
 const parsed=filePermissionSchema.safeParse(value);if(!enabled||!parsed.success)return base;
 const file=parsed.data,ids=fileHandoffOperations.filter(operation=>operation.requiredScopes.every(scope=>file.scopes.includes(scope))).map(operation=>operation.id);
 return{...base,scopes:[...new Set([...base.scopes,...file.scopes])],allowedOperationIds:[...new Set([...(base.allowedOperationIds??[]),...ids])],fileHandoff:file};
}
export function fileActor(grant:FileGrant):FileHandoffActor{
 const parsed=filePermissionSchema.safeParse(grant.fileHandoff);
 if(!parsed.success||!parsed.data.scopes.every(scope=>grant.scopes.includes(scope)))fail(403,'FILE_ACCESS_DENIED');
 return Object.freeze({ownerId:grant.ownerId,spaceId:grant.spaceId,authorityRef:'grant:'+sha256(JSON.stringify([grant.ownerId,grant.spaceId,grant.grantId])),...(!grant.oauthFence&&parsed.data.consumer==='codex'?{consumer:'codex' as const}:{})});
}
