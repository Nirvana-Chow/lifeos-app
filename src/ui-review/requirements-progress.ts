import {validateCalendarDate,validateCalendarZone} from '../calendar-candidate/domain.ts';
import type {Requirement} from '../platform/requirements';
import type {RequirementWorkflow} from '../requirements-candidate/domain';
export const workflowProgressLabels={planned:'待开发',in_progress:'进行中',blocked:'有阻塞',awaiting_review:'待工程检查',done:'开发完成',unrecorded:'未梳理'} as const;
export type WorkflowProgressState=keyof typeof workflowProgressLabels;
export type WorkflowMap=ReadonlyMap<string,RequirementWorkflow|null|undefined>;
export function workflowState(id:string,workflow?:WorkflowMap):WorkflowProgressState{return workflow?.get(id)?.state??'unrecorded';}
export function workflowCounts(rows:Requirement[],workflow?:WorkflowMap){
 const counts={planned:0,in_progress:0,blocked:0,awaiting_review:0,done:0,unrecorded:0};
 for(const row of rows)counts[workflowState(row.id,workflow)]++;
 return counts;
}
/** Only an explicit saved queue marker defines a position; the latest marker wins. */
export function developmentQueueOrder(body:string):number|null{
 const matches=[...body.matchAll(/^开发队列顺序：[ \t]*([1-9]\d*)(?:[ \t]*；下一步：[^\n]*)?[ \t]*$/gm)];
 const n=Number(matches.at(-1)?.[1]);return Number.isSafeInteger(n)&&n>0?n:null;
}
export function savedProgressEntries(body:string):{at:string;text:string}[]{
 const entries:{at:string;text:string}[]=[];
 const sections=body.split(/(?=^【[^\n]*】)/m);
 for(const section of sections){
  const match=section.match(/^【开发跟进 (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))】[ \t]*\r?\n([^]*)$/);
  if(!match||!match[2].trim())continue;
  const at=match[1];
  try{
   validateCalendarDate(at.slice(0,10));
   if(Number(at.slice(11,13))>23||Number(at.slice(14,16))>59||Number(at.slice(17,19))>59)continue;
   validateCalendarZone(at.endsWith('Z')?'UTC':at.slice(-6));
   if(Number.isFinite(Date.parse(at)))entries.push({at,text:match[2].trim()});
  }catch{/* Invalid saved timestamp sections are not progress evidence. */}
 }
 return entries.toSorted((a,b)=>Date.parse(b.at)-Date.parse(a.at));
}
