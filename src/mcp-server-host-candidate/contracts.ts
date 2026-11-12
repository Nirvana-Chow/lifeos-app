import {z} from 'zod';
import {agentOperations} from '../agent-api/capabilities.ts';
import {argumentSchema,parseArguments,type Operation} from '../mcp-candidate/schemas.ts';

/** A projection of the reviewed registry, never a second operation registry. */
export type OperationDefinition=Readonly<Operation & {inputSchema:Record<string,unknown>}>;
const reviewedIds=[
 'snapshotJournal','getJournal','createJournal','updateJournal',
 'snapshotCalendar','getCalendar','createCalendar','updateCalendar',
 'snapshotHealth','getHealth','createHealth','updateHealth',
 'snapshotPerson','getPerson','createPerson','updatePerson',
 'snapshotFinance','getFinance','createFinance','updateFinance',
 'snapshotMedia','getMedia','createMedia','updateMedia',
 'snapshotCareer','getCareer','createCareer','updateCareer',
 'snapshotPortfolio','getPortfolio','createPortfolio','updatePortfolio',
 'snapshotFeedback','getFeedback','createFeedback',
 'snapshotStorageReviews','getStorageReview','createStorageReview','updateStorageReviewChecklist','updateStorageReviewDecision',
 'snapshotRequirements','getRequirement','createRequirement','updateRequirement',
 'listTodos','snapshotTodos','getTodo','createTodo','updateTodo',
 'snapshotOrganization','getOrganization','createOrganization','updateOrganization',
] as const;
export const isObject=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
/** Sort object keys recursively; array order (including JSON Schema arrays) is significant. */
export function canonicalJSON(value:unknown):string{
 const seen=new Set<object>();
 function visit(value:unknown):unknown{
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(typeof value!=='object'||value===null||seen.has(value))throw Error('HOST_JSON_INVALID');
  if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)throw Error('HOST_JSON_INVALID');
  seen.add(value);
  const result=Array.isArray(value)?value.map(visit):Object.fromEntries(Object.keys(value).sort().map(key=>[key,visit((value as Record<string,unknown>)[key])]));
  seen.delete(value);return result;
 }
 return JSON.stringify(visit(value));
}
function freeze<T>(value:T):T{
 if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;
}
export const localDefinitions:readonly OperationDefinition[]=freeze(reviewedIds.map(id=>{
 const matches=agentOperations.filter(operation=>operation.id===id);
 if(matches.length!==1)throw Error('HOST_LOCAL_CONTRACT_INVALID');
 return structuredClone({...matches[0],inputSchema:z.toJSONSchema(argumentSchema(matches[0]))});
}));
function comparable(value:unknown):string{
 if(!isObject(value)||typeof value.id!=='string'||!value.id||typeof value.module!=='string'||typeof value.method!=='string'||typeof value.path!=='string'||typeof value.policyClass!=='string'||typeof value.description!=='string'||!isObject(value.inputSchema)||!Array.isArray(value.requiredScopes))throw Error('HOST_CATALOG_INVALID');
 const scopes=value.requiredScopes;
 if(scopes.some(scope=>typeof scope!=='string'||!/^[a-z][a-z-]*:(read|write)$/.test(scope))||new Set(scopes).size!==scopes.length)throw Error('HOST_CATALOG_INVALID');
 return canonicalJSON({...value,requiredScopes:[...scopes].sort()});
}
/** Remote subsets may remove authority; remote text can never add executable operations. */
export function intersectDefinitions(local:readonly OperationDefinition[],remote:unknown):readonly OperationDefinition[]{
 if(!isObject(remote)||remote.apiVersion!=='2'||!Array.isArray(remote.operations)||remote.operations.length>1000)throw Error('HOST_CATALOG_INVALID');
 const known=new Map(localDefinitions.map(operation=>[operation.id,comparable(operation)]));
 const selected=new Map<string,OperationDefinition>();
 for(const definition of local){if(selected.has(definition.id)||comparable(definition)!==known.get(definition.id))throw Error('HOST_LOCAL_CONTRACT_INVALID');selected.set(definition.id,definition);}
 const seen=new Set<string>();
 for(const definition of remote.operations){
  const encoded=comparable(definition);const id=(definition as Record<string,unknown>).id as string;
  if(seen.has(id))throw Error('HOST_CATALOG_INVALID');seen.add(id);
  // Compare known IDs even when a caller requested only a smaller local subset.
  if(known.has(id)&&encoded!==known.get(id))throw Error('HOST_CONTRACT_MISMATCH');
 }
 return local.filter(definition=>seen.has(definition.id));
}
export function validateHostCall(operationId:string,input:unknown):{operation:Operation;parsed:ReturnType<typeof parseArguments>;argsJSON:string}{
 const definition=localDefinitions.find(operation=>operation.id===operationId);
 if(!definition)throw Error('OPERATION_UNAVAILABLE');
 const operation=agentOperations.find(operation=>operation.id===operationId)!;
 if(!argumentSchema(operation).safeParse(input).success)throw Error('INVALID_ARGUMENTS');
 const parsed=parseArguments(operation,input);
 return{operation,parsed,argsJSON:canonicalJSON(input)};
}
