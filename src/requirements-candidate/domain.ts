import {object,PlatformError,validateId,validateRevision,validateTodo} from '../platform/domain.ts';
export const requirementWorkflowStates=['planned','in_progress','blocked','awaiting_review','done'] as const;
export type RequirementWorkflow={state:typeof requirementWorkflowStates[number];purpose:string;nextStep:string};
export type RequirementFields={workflow?:RequirementWorkflow|null;title:string;body:string;phaseId:string;priority:'P0'|'P1'|'P2'|'P3';plannedStartOn:string|null;plannedEndOn:string|null};
export type BaselineBinding={baselineVersion:string;itemVersion:number;digest:string};
export type RequirementMetadata={schema:2;id:string;baselineBinding:BaselineBinding|null;phaseId:string;priority:RequirementFields['priority'];plannedStartOn:string|null;plannedEndOn:string|null;workflow?:RequirementWorkflow|null};
export const requirementFieldKeys=['title','body','phaseId','priority','plannedStartOn','plannedEndOn'] as const;
const fail=(code:string,message:string):never=>{throw new PlatformError(400,code,message);};
export function requirementId(value:unknown):string{return typeof value==='string'&&/^LO-[A-Z]+-\d{3}$/.test(value)?value:validateId(value);}
export function validateBaselineBinding(value:unknown):BaselineBinding|null{
 if(value===null)return null;
 const v=object(value,['baselineVersion','itemVersion','digest']);
 if(typeof v.baselineVersion!=='string'||!v.baselineVersion.trim()||v.baselineVersion.length>120||typeof v.digest!=='string'||!/^[a-f0-9]{64}$/.test(v.digest))return fail('INVALID_BASELINE_BINDING','需要当前需求基线及内容摘要。');
 return {baselineVersion:v.baselineVersion,itemVersion:validateRevision(v.itemVersion),digest:v.digest};
}
export function validateRequirementFields(input:unknown):RequirementFields{
 const v=object(input,[...requirementFieldKeys,'workflow']);
 if(requirementFieldKeys.some(k=>!Object.hasOwn(v,k)))return fail('COMPLETE_REQUIREMENT_REQUIRED','保存需要完整需求字段。');
 const base=validateTodo({title:v.title,notes:v.body,dueOn:v.plannedStartOn}),end=validateTodo({title:v.title,notes:'',dueOn:v.plannedEndOn}).dueOn;
 if(typeof v.phaseId!=='string'||!/^[a-z][a-z0-9-]{0,79}$/.test(v.phaseId)||!['P0','P1','P2','P3'].includes(String(v.priority)))return fail('INVALID_REQUIREMENT_FIELDS','阶段或优先级无效。');
 if(base.dueOn&&end&&end<base.dueOn)return fail('INVALID_PLANNED_RANGE','计划结束日期不能早于开始日期。');
 return {...(Object.hasOwn(v,'workflow')?{workflow:validateRequirementWorkflow(v.workflow)}:{}),title:base.title,body:base.notes,phaseId:v.phaseId,priority:v.priority as RequirementFields['priority'],plannedStartOn:base.dueOn,plannedEndOn:end};
}
export function validateRequirementWorkflow(value:unknown):RequirementWorkflow|null{
 if(value===null)return null;
 const v=object(value,['state','purpose','nextStep']);
 if(!requirementWorkflowStates.includes(v.state as RequirementWorkflow['state'])||[v.purpose,v.nextStep].some(text=>typeof text!=='string'||text.length>4096||text.includes('\0')))return fail('INVALID_REQUIREMENT_WORKFLOW','推进状态无效，或用途、下一步不是4096字以内的文字。');
 return{state:v.state as RequirementWorkflow['state'],purpose:v.purpose as string,nextStep:v.nextStep as string};
}
export function validateRequirementMetadata(input:unknown):RequirementMetadata{
 const v=object(input,['schema','id','baselineBinding','phaseId','priority','plannedStartOn','plannedEndOn','workflow']);
 if(v.schema!==2)return fail('INVALID_REQUIREMENT_SCHEMA','需求记录版本无效。');
 const id=requirementId(v.id),binding=validateBaselineBinding(v.baselineBinding),fields=validateRequirementFields({title:'Metadata',body:'',phaseId:v.phaseId,priority:v.priority,plannedStartOn:v.plannedStartOn,plannedEndOn:v.plannedEndOn});
 if(id.startsWith('LO-')!==!!binding)return fail('INVALID_BASELINE_BINDING','公共需求必须绑定其基线。');
 return {...(Object.hasOwn(v,'workflow')?{workflow:validateRequirementWorkflow(v.workflow)}:{}),schema:2,id,baselineBinding:binding,phaseId:fields.phaseId,priority:fields.priority,plannedStartOn:fields.plannedStartOn,plannedEndOn:fields.plannedEndOn};
}
