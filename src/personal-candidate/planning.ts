import {PlatformError} from '../platform/domain.ts';
/** Optional on the wire to preserve legacy canonical requests; explicit null clears one endpoint. */
export type PersonalPlanningFields={plannedStartOn?:string|null;plannedEndOn?:string|null};
export const planningKeys=['plannedStartOn','plannedEndOn'] as const;
export function validatePlanningFields(input:Record<string,unknown>):PersonalPlanningFields{
 const result:PersonalPlanningFields={};
 for(const key of planningKeys){
  if(!Object.hasOwn(input,key))continue;
  const value=input[key];
  if(value===null){result[key]=null;continue;}
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new PlatformError(400,'INVALID_PLANNING_DATE','排期需要有效的年月日或留空。');
  const date=new Date(value+'T00:00:00Z');
  if(!Number.isFinite(date.valueOf())||date.toISOString().slice(0,10)!==value)throw new PlatformError(400,'INVALID_PLANNING_DATE','排期日期不存在。');
  result[key]=value;
 }
 if(result.plannedStartOn&&result.plannedEndOn&&result.plannedStartOn>result.plannedEndOn)throw new PlatformError(400,'INVALID_PLANNING_RANGE','计划开始日期不能晚于结束日期。');
 return result;
}
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
/** Call only after the existing update CAS. Never include previous data in the request digest. */
export function preserveOmittedPlanning<T extends object>(type:string,inputFields:unknown,previousDraft:object,nextDraft:T):T{
 if(type!=='todo'&&type!=='project')return nextDraft;
 const supplied=record(type==='project'?record(inputFields).personal:inputFields),previous=record(type==='project'?record(previousDraft).personal:previousDraft),next=record(type==='project'?record(nextDraft).personal:nextDraft);
 const planning:Record<string,unknown>={};
 for(const key of planningKeys){
  if(Object.hasOwn(supplied,key))planning[key]=next[key];
  else if(Object.hasOwn(previous,key))planning[key]=previous[key];
  else if(Object.hasOwn(next,key))planning[key]=next[key];
 }
 const merged={...next,...validatePlanningFields(planning)};
 return (type==='project'?{...nextDraft,personal:merged}:merged) as T;
}
