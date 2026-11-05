import {object,PlatformError,validateId,validateRevision} from '../platform/domain.ts';
import {validateCalendarDate} from '../calendar-candidate/domain.ts';

export const careerKinds=['education','employment','achievement','resume','opportunity'] as const;
export const applicationStates=['saved','preparing','applied','interview','offer','closed'] as const;
export type CareerKind=typeof careerKinds[number];
export type ApplicationState=typeof applicationStates[number];
export type CareerReference={id:string;sourceId:string;revision:number};
export type CareerReferenceType='project'|'domain'|'topic'|'career';
export type CareerTypedReference={type:CareerReferenceType;link:CareerReference};
export type CareerLinks={project:CareerReference|null;domain:CareerReference|null;topics:CareerReference[]};
/** YYYY, YYYY-MM or YYYY-MM-DD retain the source's actual precision. */
export type CareerPeriod={startOn:string|null;endOn:string|null;status:'unknown'|'current'|'ended'};
export type CareerEvidence={label:string;url:string|null;reference:CareerTypedReference|null};
export type CareerRequirement={requirement:string;facts:CareerReference[];gap:string|null;nextAction:string|null};
type Common={type:'career';schemaVersion:1;source:{kind:'manual';label:string|null;url:string|null};links:CareerLinks};
type Facts={highlights:string[];evidence:CareerEvidence[]};
export type CareerPersonal=Common&(
 |({careerKind:'education';organization:string|null;qualification:string|null;fieldOfStudy:string|null;period:CareerPeriod}&Facts)
 |({careerKind:'employment';organization:string|null;jobTitle:string|null;period:CareerPeriod}&Facts)
 |({careerKind:'achievement';organization:string|null;achievedOn:string|null}&Facts)
 |{careerKind:'resume';targetRole:string|null;facts:CareerReference[]}
 |{careerKind:'opportunity';company:string|null;role:string|null;direction:string|null;applicationState:ApplicationState;nextStep:string|null;nextStepOn:string|null;requirements:CareerRequirement[]}
);
export type CareerPersonalFields={title:string;text:string;occurredOn:string|null;personal:CareerPersonal};
const invalid=(message='请核对职业记录的字段、来源与关联。'):never=>{throw new PlatformError(400,'INVALID_CAREER_FIELDS',message);};
function complete(value:unknown,keys:readonly string[]):Record<string,unknown>{const v=object(value,keys);if(keys.some(k=>!Object.hasOwn(v,k)||v[k]===undefined))return invalid('请提交完整字段；未知资料请明确填写 null 或空数组。');return v;}
function text(value:unknown,max:number,nullable=false):string|null{if(value===null&&nullable)return null;if(typeof value!=='string'||value.length>max||value.includes('\0'))return invalid();return value.trim()|| (nullable?null:'');}
function url(value:unknown):string|null{const result=text(value,2048,true);if(result===null)return null;try{const parsed=new URL(result);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)return invalid('来源链接需要无账户信息的 http 或 https 地址。');}catch{return invalid('来源链接需要有效的 http 或 https 地址。');}return result;}
export function validateCareerDate(value:unknown):string|null{
 if(value===null)return null;
 if(typeof value!=='string'||!/^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-\d{2})?)?$/.test(value)||Number(value.slice(0,4))<1)return invalid('日期请填写已知的 YYYY、YYYY-MM 或 YYYY-MM-DD，未知请留空。');
 if(value.length===10)validateCalendarDate(value);else if(value.length!==4&&value.length!==7)return invalid();return value;
}
function period(value:unknown):CareerPeriod{
 const v=complete(value,['startOn','endOn','status']);if(!['unknown','current','ended'].includes(String(v.status)))return invalid();
 const startOn=validateCareerDate(v.startOn),endOn=validateCareerDate(v.endOn);
 if(v.status==='current'&&endOn!==null)return invalid('在读或在职记录不能同时填写结束日期。');
 // Compare possible boundaries only. Never manufacture stored months/days from a partial date.
 const lower=(d:string)=>d.length===4?d+'-01-01':d.length===7?d+'-01':d;
 const upper=(d:string)=>d.length===4?d+'-12-31':d.length===7?d+'-31':d;
 if(startOn&&endOn&&lower(startOn)>upper(endOn))return invalid('结束日期不能早于开始日期。');
 return{startOn,endOn,status:v.status as CareerPeriod['status']};
}
function reference(value:unknown):CareerReference|null{if(value===null)return null;const v=complete(value,['id','sourceId','revision']);return{id:validateId(v.id),sourceId:validateId(v.sourceId),revision:validateRevision(v.revision)};}
function references(value:unknown,max=60):CareerReference[]{if(!Array.isArray(value)||value.length>max)return invalid('关联条目数量超限。');const result=value.map(v=>reference(v)??invalid());if(new Set(result.map(r=>r.id)).size!==result.length)return invalid('同一组关联不能重复。');return result;}
function links(value:unknown):CareerLinks{const v=complete(value,['project','domain','topics']);return{project:reference(v.project),domain:reference(v.domain),topics:references(v.topics,20)};}
function facts(value:Record<string,unknown>):Facts{
 if(!Array.isArray(value.highlights)||value.highlights.length>60||!Array.isArray(value.evidence)||value.evidence.length>30)return invalid();
 const highlights=value.highlights.map(v=>text(v,2000)??invalid()).filter(Boolean);
 const evidence=value.evidence.map(item=>{const e=complete(item,['label','url','reference']);let ref:CareerTypedReference|null=null;
  if(e.reference!==null){const r=complete(e.reference,['type','link']);if(!['project','domain','topic','career'].includes(String(r.type)))return invalid();ref={type:r.type as CareerReferenceType,link:reference(r.link)??invalid()};}
  const label=text(e.label,240),address=url(e.url);if(!label||!address&&!ref)return invalid('证据需要名称，以及来源链接或已有关联记录。');return{label,url:address,reference:ref};
 });return{highlights,evidence};
}
export function emptyCareerPersonal(kind:CareerKind='education'):CareerPersonal{
 if(!careerKinds.includes(kind))return invalid();
 const common:Common={type:'career',schemaVersion:1,source:{kind:'manual',label:null,url:null},links:{project:null,domain:null,topics:[]}};
 if(kind==='resume')return{...common,careerKind:kind,targetRole:null,facts:[]};
 if(kind==='opportunity')return{...common,careerKind:kind,company:null,role:null,direction:null,applicationState:'saved',nextStep:null,nextStepOn:null,requirements:[]};
 const fact:Facts={highlights:[],evidence:[]};
 if(kind==='achievement')return{...common,...fact,careerKind:kind,organization:null,achievedOn:null};
 const range:CareerPeriod={startOn:null,endOn:null,status:'unknown'};
 return kind==='education'?{...common,...fact,careerKind:kind,organization:null,qualification:null,fieldOfStudy:null,period:range}:{...common,...fact,careerKind:kind,organization:null,jobTitle:null,period:range};
}
export function validateCareerPersonal(value:unknown):CareerPersonal{
 const header=object(value,['type','schemaVersion','source','links','careerKind','organization','qualification','fieldOfStudy','period','highlights','evidence','jobTitle','achievedOn','targetRole','facts','company','role','direction','applicationState','nextStep','nextStepOn','requirements']);
 const kind=header.careerKind;if(!careerKinds.includes(kind as CareerKind))return invalid();
 const keys=kind==='education'?['organization','qualification','fieldOfStudy','period','highlights','evidence']:kind==='employment'?['organization','jobTitle','period','highlights','evidence']:kind==='achievement'?['organization','achievedOn','highlights','evidence']:kind==='resume'?['targetRole','facts']:['company','role','direction','applicationState','nextStep','nextStepOn','requirements'];
 const v=complete(value,['type','schemaVersion','source','links','careerKind',...keys]),source=complete(v.source,['kind','label','url']);
 if(v.type!=='career'||v.schemaVersion!==1||source.kind!=='manual')return invalid('目前仅支持本人手工记录；不声称已导入、核实或投递。');
 const common:Common={type:'career',schemaVersion:1,source:{kind:'manual',label:text(source.label,240,true),url:url(source.url)},links:links(v.links)};
 if(kind==='education')return{...common,careerKind:kind,organization:text(v.organization,240,true),qualification:text(v.qualification,240,true),fieldOfStudy:text(v.fieldOfStudy,240,true),period:period(v.period),...facts(v)};
 if(kind==='employment')return{...common,careerKind:kind,organization:text(v.organization,240,true),jobTitle:text(v.jobTitle,240,true),period:period(v.period),...facts(v)};
 if(kind==='achievement')return{...common,careerKind:kind,organization:text(v.organization,240,true),achievedOn:validateCareerDate(v.achievedOn),...facts(v)};
 if(kind==='resume')return{...common,careerKind:kind,targetRole:text(v.targetRole,240,true),facts:references(v.facts)};
 if(!applicationStates.includes(v.applicationState as ApplicationState)||!Array.isArray(v.requirements)||v.requirements.length>40)return invalid();
 const requirements=v.requirements.map(item=>{const r=complete(item,['requirement','facts','gap','nextAction']);const requirement=text(r.requirement,2000);if(!requirement)return invalid('请填写具体岗位要求。');return{requirement,facts:references(r.facts),gap:text(r.gap,4000,true),nextAction:text(r.nextAction,4000,true)};});
 return{...common,careerKind:'opportunity',company:text(v.company,240,true),role:text(v.role,240,true),direction:text(v.direction,240,true),applicationState:v.applicationState as ApplicationState,nextStep:text(v.nextStep,4000,true),nextStepOn:v.nextStepOn===null?null:validateCalendarDate(v.nextStepOn),requirements};
}
export function normalizeCareerPersonalFields(value:unknown):CareerPersonalFields{
 const v=complete(value,['title','text','occurredOn','personal']),title=text(v.title,240);if(!title)return invalid('请填写记录名称。');
 if(typeof v.text!=='string'||v.text.length>16384||v.text.includes('\0'))return invalid('原文或经历正文过长或格式无效。');
 return{title,text:v.text,occurredOn:v.occurredOn===null?null:validateCalendarDate(v.occurredOn),personal:validateCareerPersonal(v.personal)};
}
/** PersonalService remains the sole authority for owner/space/type/current-revision checks. */
export type CareerLockedReference=CareerTypedReference&{expectedKinds?:readonly ['education','employment','achievement']};
export function careerPersonalReferences(p:CareerPersonal):CareerLockedReference[]{
 const result:CareerLockedReference[]=[...(p.links.project?[{type:'project' as const,link:p.links.project}]:[]),...(p.links.domain?[{type:'domain' as const,link:p.links.domain}]:[]),...p.links.topics.map(link=>({type:'topic' as const,link}))];
 const factReference=(link:CareerReference):CareerLockedReference=>({type:'career',link,expectedKinds:['education','employment','achievement']});
 if(p.careerKind==='resume')result.push(...p.facts.map(factReference));
 else if(p.careerKind==='opportunity')for(const r of p.requirements)result.push(...r.facts.map(factReference));
 else for(const e of p.evidence)if(e.reference)result.push(e.reference.type==='career'?factReference(e.reference.link):e.reference);
 return result;
}
