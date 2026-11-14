import {agentOperations,businessMcpOperations} from '../agent-api/capabilities.ts';
import {organizationTypes} from '../agent-api/organization.ts';
import {validateId} from '../platform/domain.ts';
import {requirementId} from '../requirements-candidate/domain.ts';
import type {Operation} from '../mcp-candidate/schemas.ts';

// Derived only from the source-owned API registry's explicit review metadata.
const businessOperationIds:ReadonlySet<string>=new Set(businessMcpOperations.map(operation=>operation.id));

export function isBusinessMcpOperation(operationId:string):boolean{return businessOperationIds.has(operationId);}

function matchesPath(operation:Operation,path:string):boolean{
 const expected=operation.path.split('/'),actual=path.split('/');
 if(expected.length!==actual.length)return false;
 return expected.every((part,index)=>{
  const value=actual[index];
  if(part==='{type}')return organizationTypes.some(type=>type===value);
  if(part==='{id}'){
   try{return (operation.module==='requirements'?requirementId(value):validateId(value))===value;}catch{return false;}
  }
  return part===value;
 });
}

/** Relative Agent routes only; discovery is an internal read, never a tool operation. */
export function isBusinessMcpApiRoute(method:string,path:string):boolean{
 if(path==='/v2/capabilities')return method==='GET';
 return agentOperations.some(operation=>isBusinessMcpOperation(operation.id)&&operation.method===method&&matchesPath(operation,path));
}
