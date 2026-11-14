/** Source-owned review metadata. It is never accepted from request/catalog JSON. */
export type McpExposure='business-json'|'business-preview'|'explicit-file'|'owner-review'|'engineering'|'native'|'internal';
type RegistryOperation=Readonly<{module:string;policyClass?:string;mcpExposure?:string}>;
type WireOperation<T>=T extends unknown?Omit<T,'mcpExposure'>:never;
/** Preserve the existing public Agent/SDK contract exactly. */
export function operationWireContract<T extends RegistryOperation>(operation:T):WireOperation<T>{
 const{mcpExposure:_,...wire}=operation;return wire as WireOperation<T>;
}
/** A future reviewed source entry joins this projection in its normal delivery. */
export function projectMcpBusinessOperations<T extends RegistryOperation>(registry:readonly T[],oauth=false,producerBinding=false):readonly WireOperation<T>[] {
 return registry.filter(operation=>{
  if(operation.mcpExposure==='explicit-file')return operation.module==='fileHandoff'&&operation.policyClass==='explicit-file-handoff';
  if(operation.policyClass!=='personal-business-data'||operation.module==='fileHandoff')return false;
  return operation.mcpExposure==='business-json'||(!oauth||producerBinding)&&operation.mcpExposure==='business-preview';
 }).map(operationWireContract);
}
