import {object,PlatformError,validateId,validateRevision,validateTodo} from '../platform/domain.ts';
import {requirementId,validateBaselineBinding,type BaselineBinding} from '../requirements-candidate/domain.ts';

export type RequirementReference={id:string;revision:number;sourceId:string|null;baselineBinding:BaselineBinding|null};
export type FeedbackState='inbox'|'linked'|'converted'|'archived';
export type FeedbackMetadata={schema:1;type:'feedback';state:FeedbackState;references:RequirementReference[]};
export type ReleaseReadMetadata={schema:1;type:'release-read';sourceSha:string};
export type RequirementSupportMetadata=FeedbackMetadata|ReleaseReadMetadata;
export type FeedbackInput={title:string;text:string;sourceLabel:string|null};
const invalid=(message='反馈或版本状态无效。'):never=>{throw new PlatformError(400,'INVALID_REQUIREMENT_SUPPORT',message);};

export function validateFeedbackInput(input:unknown):FeedbackInput{
 const v=object(input,['title','text','sourceLabel']);
 if(typeof v.text!=='string'||!v.text.trim())return invalid('请输入反馈原文。');
 const title=v.title===undefined?v.text.split(/\r?\n/).find(line=>line.trim())!.trim().slice(0,240):v.title;
 const base=validateTodo({title,notes:v.text,dueOn:null});
 const label=v.sourceLabel===undefined?null:v.sourceLabel;
 if(label!==null&&(typeof label!=='string'||!label.trim()||label.length>240||label.includes('\0')))return invalid('来源说明无效。');
 return{title:base.title,text:base.notes,sourceLabel:label===null?null:label as string};
}
export function validateRequirementReference(input:unknown):RequirementReference{
 const v=object(input,['id','revision','sourceId','baselineBinding']),id=requirementId(v.id),binding=validateBaselineBinding(v.baselineBinding);
 const revision=v.revision===0&&id.startsWith('LO-')?0:validateRevision(v.revision);
 const sourceId=revision===0&&v.sourceId===null?null:validateId(v.sourceId);
 if(id.startsWith('LO-')!==!!binding||revision===0&&sourceId!==null)return invalid('需求来源版本不匹配。');
 return{id,revision,sourceId,baselineBinding:binding};
}
export function validateRequirementSupportMetadata(input:unknown):RequirementSupportMetadata{
 const v=object(input,['schema','type','state','references','sourceSha']);if(v.schema!==1)return invalid();
 if(v.type==='release-read'){
  object(input,['schema','type','sourceSha']);if(typeof v.sourceSha!=='string'||!/^[a-f0-9]{40}$/.test(v.sourceSha))return invalid();
  return{schema:1,type:'release-read',sourceSha:v.sourceSha};
 }
 object(input,['schema','type','state','references']);
 if(v.type!=='feedback'||!['inbox','linked','converted','archived'].includes(String(v.state))||!Array.isArray(v.references)||v.references.length>20)return invalid();
 const references=v.references.map(validateRequirementReference);
 if(new Set(references.map(r=>r.id)).size!==references.length||v.state==='inbox'&&references.length!==0||v.state==='linked'&&!references.length||v.state==='converted'&&references.length!==1)return invalid();
 return{schema:1,type:'feedback',state:v.state as FeedbackState,references};
}
