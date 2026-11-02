import type {RecordEntry,RecordFields,RecordType,ProjectLink} from '../records-candidate/contracts.ts';
import {validateRecordFields} from '../records-candidate/domain.ts';
export const recordLabels:Record<RecordType,string>={learning:'学习',career:'职业',mood:'情绪',article:'文章',resource:'资料',project:'项目',training:'实际训练'};
export type RecordForm={type:RecordType;title:string;text:string;occurredOn:string;topic:string;status:string;nextStep:string;resourceURL:string;evidence:string;label:string;intensity:string;author:string;attribution:string;sourceURL:string;url:string;stage:string;completionStatus:string;completionEvidence:string;testingOutcome:string;testingEvidence:string;links:ProjectLink[];exercise:string;trainingSets:{reps:string;weight:string;weightUnit:string;duration:string;durationUnit:string}[]};
export function emptyRecordForm(type:RecordType):RecordForm{return {type,title:'',text:'',occurredOn:'',topic:'',status:'',nextStep:'',resourceURL:'',evidence:'',label:'',intensity:'',author:'',attribution:'',sourceURL:'',url:'',stage:'',completionStatus:'',completionEvidence:'',testingOutcome:'',testingEvidence:'',links:[],exercise:'',trainingSets:[]};}
export function fieldsToForm(fields:RecordFields):RecordForm{
 const form={...emptyRecordForm(fields.record.type),title:fields.title,text:fields.text,occurredOn:fields.occurredOn??''},metadata=fields.record;
 switch(metadata.type){case 'training':return {...form,exercise:metadata.exercise??'',trainingSets:metadata.sets.map(row=>({reps:row.reps===null?'':String(row.reps),weight:row.weight===null?'':String(row.weight.value),weightUnit:row.weight?.unit??'',duration:row.duration===null?'':String(row.duration.value),durationUnit:row.duration?.unit??''}))};case 'learning':return {...form,topic:metadata.topic,status:metadata.status,nextStep:metadata.nextStep??'',resourceURL:metadata.resourceURL??''};case 'career':return {...form,evidence:metadata.evidence,nextStep:metadata.nextStep??''};case 'mood':return {...form,label:metadata.label,intensity:metadata.intensity===null?'':String(metadata.intensity)};case 'article':return {...form,author:metadata.author??'',attribution:metadata.attribution,sourceURL:metadata.sourceURL??''};case 'resource':return {...form,url:metadata.url,author:metadata.author??''};case 'project':return {...form,links:structuredClone(metadata.links??[]),stage:metadata.stage,nextStep:metadata.nextStep??'',completionStatus:metadata.completion.status,completionEvidence:metadata.completion.evidence??'',testingOutcome:metadata.testing.outcome,testingEvidence:metadata.testing.evidence??''};}
}
export const entryToForm=(entry:RecordEntry)=>fieldsToForm(entry.draft);
export function formToFields(form:RecordForm):RecordFields{
 const base={type:form.type,syntheticOnly:true},optional=(value:string)=>value.trim()?value:null;let record:unknown;
 switch(form.type){
  case 'training':{const numeric=(value:string)=>{if(!/^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))throw Error('测量值需要非负数字；未知留空。');return Number(value);};record={...base,exercise:optional(form.exercise),sets:form.trainingSets.map(row=>({reps:row.reps===''?null:numeric(row.reps),weight:row.weight===''?null:{value:numeric(row.weight),unit:row.weightUnit},duration:row.duration===''?null:{value:numeric(row.duration),unit:row.durationUnit}}))};break;}

  case 'learning':record={...base,topic:form.topic,status:form.status,nextStep:optional(form.nextStep),resourceURL:optional(form.resourceURL)};break;
  case 'career':record={...base,evidence:form.evidence,nextStep:optional(form.nextStep)};break;
  case 'mood':if(form.intensity!==''&&!/^[1-5]$/.test(form.intensity))throw Error('情绪强度只能选择 1–5，或留空。');record={...base,label:form.label,intensity:form.intensity===''?null:Number(form.intensity)};break;
  case 'article':record={...base,author:optional(form.author),attribution:form.attribution,sourceURL:optional(form.sourceURL)};break;
  case 'resource':record={...base,url:form.url,author:optional(form.author)};break;
  case 'project':record={...base,...(form.links.length?{links:structuredClone(form.links)}:{}),stage:form.stage,nextStep:optional(form.nextStep),completion:{selfReported:true,status:form.completionStatus,evidence:optional(form.completionEvidence)},testing:{manuallyRecorded:true,outcome:form.testingOutcome,evidence:optional(form.testingEvidence)},review:{decision:'pending',evidence:null}};break;
 }
 const fields={title:form.title,text:form.text,occurredOn:form.occurredOn||null,record} as RecordFields;validateRecordFields(fields);return fields;
}
