import {agentCapabilityOperations as agentOperations} from './capabilities.ts';
import {normalizeAgentScopes,agentScopes} from './scopes.ts';
import type {OperationScope} from './personal-operation-registry.ts';
import {decodeAgentPermissions} from './scopes.ts';
import {filePermissionSchema,type FilePermission} from '../file-handoff/permission-contracts.ts';

export const allPersonalBusinessPolicy = 'all-personal-business-v1' as const;
export type BusinessDataPolicy = typeof allPersonalBusinessPolicy;
export type PolicyOperation = Readonly<{id:string;requiredScopes:readonly string[];policyClass?:string}>;
const protectedDomains = new Set(['account','security','key','keys','apikey','auth','settings','system','payment','payments','order','orders']);
/** The registry is server-owned reviewed code, never request JSON or business records. */
export function policyOperationScopes(operation:PolicyOperation):readonly string[]|null {
 if(operation.policyClass!=='personal-business-data'||!operation.requiredScopes.length||new Set(operation.requiredScopes).size!==operation.requiredScopes.length)return null;
 // Preserve the pre-policy v2 contract for these exact stable operations only.
 const legacyTodoWrite=['createTodo','updateTodo'].includes(operation.id)&&operation.requiredScopes.length===1&&operation.requiredScopes[0]==='todo:write';
 for(const scope of operation.requiredScopes){
  const match=/^([a-z][a-z0-9-]*):(read|write)$/.exec(scope);
  if(!match||protectedDomains.has(match[1])||match[2]==='write'&&!operation.requiredScopes.includes(match[1]+':read')&&!legacyTodoWrite)return null;
 }
 return operation.requiredScopes;
}
/** Grant authorization closes legacy todo writes to read+write without changing advertisements or SQL operation claims. */
export function policyAuthorizationScopes(operation:PolicyOperation):readonly string[]|null {
 const scopes=policyOperationScopes(operation);
 return scopes?.length===1&&scopes[0]==='todo:write'?['todo:read','todo:write']:scopes;
}
export type PolicyGrantRow=Readonly<{id:string;referenceId:string;metadata:unknown;permissions:unknown;enabled:boolean|null;expiresAt:string|Date|null}>;
export type PolicyResolutionOptions=Readonly<{ownerId:string;spaceId:string;now:number;policyEnabled?:boolean;registry:readonly PolicyOperation[];operationAvailable:(id:string)=>boolean}>;
/** Candidate shared resolver; live activation also requires the policy-aware SQL fence and management CAS. */
export function resolveBusinessPolicyGrant(row:PolicyGrantRow,options:PolicyResolutionOptions){
 try{
  const metadata=typeof row.metadata==='string'?JSON.parse(row.metadata):row.metadata;
  const permissions=typeof row.permissions==='string'?JSON.parse(row.permissions):row.permissions;
  const scopes=decodeAgentPermissions(permissions);
  const expires=row.expiresAt===null?null:new Date(row.expiresAt).valueOf();
  if(!Number.isFinite(options.now)||row.referenceId!==options.ownerId||!metadata||typeof metadata!=='object'||Array.isArray(metadata)||metadata.spaceId!==options.spaceId||row.enabled!==true&&row.enabled!==null||expires!==null&&(!Number.isFinite(expires)||expires<=options.now)||!scopes)return null;
  if(!Object.hasOwn(metadata,'businessDataPolicy'))return {scopes,allowedOperationIds:options.registry.filter(op=>op.requiredScopes.every(scope=>scopes.includes(scope as typeof scopes[number]))&&options.operationAvailable(op.id)).map(op=>op.id)};
  if(metadata.businessDataPolicy!==allPersonalBusinessPolicy||options.policyEnabled!==true||row.enabled!==true||expires===null)return null;
  const operations=options.registry.filter(op=>policyOperationScopes(op)!==null&&options.operationAvailable(op.id));
  return {businessDataPolicy:allPersonalBusinessPolicy,scopes:[...new Set(operations.flatMap(op=>policyAuthorizationScopes(op)!))],allowedOperationIds:operations.map(op=>op.id)};
 }catch{return null;}
}

/** New effective scopes can only originate from reviewed, explicitly allowed server operations. */
export function normalizeOperationGrantScopes(grant:{scopes:readonly string[];businessDataPolicy?:string;allowedOperationIds?:readonly string[];fileHandoff?:FilePermission}):readonly OperationScope[]{
 if(grant.fileHandoff){
  const proof=filePermissionSchema.parse(grant.fileHandoff),scopes=grant.scopes.filter(scope=>scope.startsWith('file-handoff:'));
  if(scopes.length!==proof.scopes.length||!scopes.every(scope=>proof.scopes.includes(scope as never)))throw Error('Invalid file permission');
  const{fileHandoff:_,...base}=grant;
  const original=normalizeOperationGrantScopes({...base,scopes:grant.scopes.filter(scope=>!scope.startsWith('file-handoff:')),allowedOperationIds:grant.allowedOperationIds?.filter(id=>!['stageFileHandoff','getFileHandoff','downloadFileHandoff','acknowledgeFileHandoff'].includes(id))});
  return Object.freeze([...original,...scopes].sort()) as readonly OperationScope[];
 }
 if(!grant.businessDataPolicy)return normalizeAgentScopes(grant.scopes);
 if(grant.businessDataPolicy!==allPersonalBusinessPolicy||!Array.isArray(grant.scopes)||new Set(grant.scopes).size!==grant.scopes.length||!Array.isArray(grant.allowedOperationIds)||new Set(grant.allowedOperationIds).size!==grant.allowedOperationIds.length)throw Error('Invalid policy grant');
 const allowed=grant.allowedOperationIds.map(id=>{const operation=agentOperations.find(op=>op.id===id);if(!operation||policyAuthorizationScopes(operation)===null)throw Error('Invalid policy operation');return operation;});
 const known=new Set<string>([...agentScopes,...allowed.flatMap(op=>policyAuthorizationScopes(op)!)]);
 if(grant.scopes.some(scope=>!known.has(scope)))throw Error('Invalid policy scopes');
 for(const scope of grant.scopes)if(scope.endsWith(':write')&&!grant.scopes.includes(scope.replace(/:write$/,':read')))throw Error('Invalid policy scopes');
 return Object.freeze([...grant.scopes].sort()) as readonly OperationScope[];
}
