import type {PublicEntry} from '../platform/contracts.ts';
import {object,validateId,validateRevision} from '../platform/domain.ts';
import {applicationStates,normalizeCareerPersonalFields,type CareerPersonal,type CareerPersonalFields,type CareerReference,type CareerRequirement,type CareerPeriod} from './domain.ts';
import {formatCareerDates} from './resume-dates.ts';

/** Root passes an independently authorized PersonalService response; these are presentation projections. */
export type CareerRecord={id:string;sourceId:string;revision:number;fields:CareerPersonalFields};
export type CareerRow=CareerRecord&{title:string;summary:string[];entry:PublicEntry};
export const careerKindLabels={education:'教育经历',employment:'工作经历',achievement:'成果与人生经历',resume:'简历版本',opportunity:'职位与 JD'};
export const applicationStateLabels={saved:'已收藏',preparing:'准备中',applied:'已投递',interview:'面试中',offer:'已获 Offer',closed:'已结束'};
export const careerPeriodLabel=formatCareerDates;
export function careerSummary(p:CareerPersonal):string[]{
 if(p.careerKind==='resume')return[p.targetRole??'目标岗位未填',`关联 ${p.facts.length} 条事实`];
 if(p.careerKind==='opportunity')return[p.company??'公司未知',p.role??'岗位未知',applicationStateLabels[p.applicationState],...(p.nextStep?[p.nextStep]:[])];
 return[p.organization??'机构未知',...(p.careerKind==='education'?[p.qualification,p.fieldOfStudy]:p.careerKind==='employment'?[p.jobTitle]:[]).filter((v):v is string=>v!==null),p.careerKind==='achievement'?p.achievedOn??'日期未知':careerPeriodLabel(p.period)];
}
export function projectCareerEntries(entries:readonly PublicEntry[],spaceId:string,search=''):CareerRow[]{
 const result:CareerRow[]=[],query=search.trim().toLocaleLowerCase();
 for(const entry of entries)try{
  const source=entry.source,original=object(source.original,['marker','spaceId','type','input']),input=object(original.input,['spaceId','confirmed','fields']);
  if(original.marker!=='personal-manual-v1'||original.type!=='career'||original.spaceId!==spaceId||input.spaceId!==spaceId||input.confirmed!==true||source.system!=='website'||source.externalId!==entry.id||source.version!==1||entry.kind!=='inbox'||entry.syncState!=='draft'||entry.externalStatus!==null)continue;
  normalizeCareerPersonalFields(input.fields);
  const draft=object(entry.draft,['title','text','occurredOn','personal','disposition']);if(draft.disposition!=='reference')continue;
  const fields=normalizeCareerPersonalFields({title:draft.title,text:draft.text,occurredOn:draft.occurredOn,personal:draft.personal});
  if(query&&!JSON.stringify(fields).toLocaleLowerCase().includes(query))continue;
  result.push({id:validateId(entry.id),sourceId:validateId(source.id),revision:validateRevision(entry.revision),fields,title:fields.title,summary:careerSummary(fields.personal),entry});
 }catch{/* Invalid/other records never become inferred career facts; caller retains service errors. */}
 return result;
}
export function isCareerFact(record:CareerRecord):boolean{return ['education','employment','achievement'].includes(record.fields.personal.careerKind);}
const match=(record:CareerRecord,pin:CareerReference)=>record.id===pin.id&&record.sourceId===pin.sourceId&&record.revision===pin.revision&&isCareerFact(record);
function resolveFacts(pins:readonly CareerReference[],records:readonly CareerRecord[]){
 const facts:CareerRecord[]=[],unavailable:CareerReference[]=[];
 for(const pin of pins){const fact=records.find(row=>match(row,pin));if(fact)facts.push(fact);else unavailable.push(pin);}
 return{facts,unavailable};
}
export type CareerRequirementRow=Omit<CareerRequirement,'facts'>&{facts:CareerRecord[];unavailable:CareerReference[]};
export function projectCareerRequirements(p:CareerPersonal,records:readonly CareerRecord[]):CareerRequirementRow[]{
 return p.careerKind==='opportunity'?p.requirements.map(r=>({...r,...resolveFacts(r.facts,records)})):[];
}
export function projectResumeFacts(selected:CareerRecord|null,records:readonly CareerRecord[]){
 return selected?.fields.personal.careerKind==='resume'?resolveFacts(selected.fields.personal.facts,records):{facts:[],unavailable:[]};
}
export function projectCareerBoard(records:readonly CareerRecord[]){return applicationStates.map(state=>({state,records:records.filter(r=>r.fields.personal.careerKind==='opportunity'&&r.fields.personal.applicationState===state)}));}
