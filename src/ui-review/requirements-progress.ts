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
  if(match&&Number.isFinite(Date.parse(match[1]))&&match[2].trim())entries.push({at:match[1],text:match[2].trim()});
 }
 return entries.toSorted((a,b)=>Date.parse(b.at)-Date.parse(a.at));
}
