import type {RecordEntry,RecordFields,RecordMutationResult,RecordType,ProjectReview,ProjectLink,ProjectLinkCandidate,ProjectLinkCandidatesResponse,ProjectRecapResponse} from '../records-candidate/contracts.ts';
import {validateRecordFields,validateRecordType,validateRecordCommand,validateProjectReviewCommand,projectReviewAfterEdit,normalizeProjectLinks} from '../records-candidate/domain.ts';
import {SearchClient,SearchRequestError} from '../search-workbench/client.ts';
import type {SourceResponse} from '../search-candidate/contracts.ts';
import {validateId,validateRevision,validateIdempotencyKey,object} from '../platform/domain.ts';

export type RecordTarget={id:string;revision:number;type:RecordType;baseline?:RecordEntry};
export type RecordCommand=Readonly<{path:string;method:'POST'|'PATCH';body:string;key:string;ownerId:string;baseline?:string}>;
export class RecordRequestError extends Error{
 readonly status:number;readonly code:string;readonly uncertain:boolean;
 constructor(status:number,code:string,message:string,uncertain=false){super(message);this.name='RecordRequestError';this.status=status;this.code=code;this.uncertain=uncertain;}
}
const isObject=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const messages:Record<string,string>={DATA_READER_INCOMPATIBLE:'记录类型不兼容，请使用兼容版本或完整原样导出。',TRAINING_WRITES_DISABLED:'训练写入默认关闭；当前只读，完成兼容、数据库和界面验收后再启用。',LOGIN_REQUIRED:'登录已失效，请使用同一评审账号重新登录。',ACCOUNT_NOT_ALLOWED:'当前账号没有访问此记录的权限。',ACCOUNT_CHANGED:'当前登录账号与原请求不同；请恢复原评审账号再重试。',REVISION_CONFLICT:'记录已更新，请读取最新版本并核对修改。',COMMAND_CONFLICT:'请求标识发生冲突，原保存结果仍需核对。',NOT_FOUND:'记录不存在，或当前账号不能查看此类别。',INVALID_DATE:'请填写有效的年月日，或留空。',INVALID_RECORD:'类别字段未通过校验，请核对输入。',INVALID_TEXT:'请核对必填文字与长度。',INVALID_PROJECT_LINK:'请核对关联来源，最多选择 20 条且不能重复。',PROJECT_LINK_UNAVAILABLE:'关联来源已变化或不可用，请重新核对关联后再保存或验收。'};
const rejectedBeforeWrite:Record<number,readonly string[]>={
 400:['INVALID_BODY','UNKNOWN_FIELD','INVALID_TEXT','INVALID_DATE','INVALID_REVISION','INVALID_ID','INVALID_IDEMPOTENCY_KEY','INVALID_JSON','INVALID_TRAINING','INVALID_RECORD_TYPE','INVALID_RECORD_TEXT','INVALID_RECORD_URL','INVALID_RECORD_DISPOSITION','INVALID_LEARNING_STATUS','INVALID_MOOD_INTENSITY','INVALID_ARTICLE_ATTRIBUTION','INVALID_PROJECT_LINK','INVALID_PROJECT_STAGE','INVALID_PROJECT_COMPLETION','INVALID_PROJECT_TESTING','INVALID_PROJECT_REVIEW','PROJECT_REVIEW_ACTION_REQUIRED','CONFIRMATION_REQUIRED','SYNTHETIC_ONLY','RECORD_TYPE_MISMATCH'],
 404:['NOT_FOUND'],405:['METHOD_NOT_ALLOWED'],409:['REVISION_CONFLICT','REVISION_LIMIT','PROJECT_LINK_UNAVAILABLE'],413:['BODY_TOO_LARGE'],415:['JSON_REQUIRED'],
};
const same=(a:unknown,b:unknown):boolean=>{
 if(a===b)return true;if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>same(value,b[index]));if(!isObject(a)||!isObject(b))return false;
 const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]));
};
function timestamp(value:unknown):boolean{return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===(value.includes('.')?value:value.replace('Z','.000Z'));}
function owner(value:unknown):string{if(typeof value!=='string'||!value.trim()||value.length>256||/[\u0000-\u001f\u007f]/.test(value))throw Error('无法核对保存账号。');return value;}
function fullFields(value:unknown):RecordFields{
 if(!isObject(value)||!['title','text','occurredOn','record'].every(key=>Object.hasOwn(value,key)))throw Error('Incomplete record fields');
 return validateRecordFields({title:value.title,text:value.text,occurredOn:value.occurredOn,record:value.record});
}
function comparableDraft(value:Record<string,unknown>):unknown{
 const record=value.record;return {title:value.title,text:value.text,occurredOn:value.occurredOn,record:isObject(record)&&record.type==='project'&&!Object.hasOwn(record,'links')?{...record,links:[]}:record};
}
function parseLinkCandidate(value:unknown):ProjectLinkCandidate{
 const candidate=object(value,['link','title','summary','updatedAt']),links=normalizeProjectLinks([candidate.link]);
 if(!same(links[0],candidate.link)||typeof candidate.title!=='string'||!candidate.title.trim()||candidate.title.length>240||candidate.title.includes('\0')||typeof candidate.summary!=='string'||candidate.summary.length>500||candidate.summary.includes('\0')||!timestamp(candidate.updatedAt))throw Error('Invalid link candidate');
 return structuredClone(candidate) as ProjectLinkCandidate;
}
export function parseRecordEntry(value:unknown,type:RecordType):RecordEntry{
 validateRecordType(type);
 if(!isObject(value)||value.kind!=='inbox'||value.syncState!=='draft'||value.externalStatus!==null||'ownerId'in value||!isObject(value.source)||!isObject(value.draft)||value.draft.disposition!=='reference')throw Error('Invalid record response');
 object(value,['id','kind','draft','source','revision','createdAt','updatedAt','syncState','externalStatus']);
 validateId(value.id);validateRevision(value.revision);object(value.draft,['title','text','occurredOn','record','disposition']);
 const fields=fullFields(value.draft);if(fields.record.type!==type||!same(fields,comparableDraft(value.draft)))throw Error('Invalid record draft');
 const source=value.source;object(source,['id','system','externalId','version','asOf','original']);validateId(source.id);validateRevision(source.version);
 if(!isObject(source.original))throw Error('Invalid record original');object(source.original,['title','text','occurredOn','record','disposition']);
 const original=validateRecordFields({title:source.original.title,text:source.original.text,occurredOn:source.original.occurredOn,record:source.original.record});
 if(source.system!=='website'||source.externalId!==value.id||validateRevision(source.version)>Number(value.revision)||!timestamp(source.asOf)||!timestamp(value.createdAt)||!timestamp(value.updatedAt)||!isObject(source.original)||source.original.disposition!=='reference'||original.record.type!==type)throw Error('Invalid record provenance');
 return structuredClone(value) as RecordEntry;
}
function projectBaseline(value:unknown,target?:RecordTarget):RecordEntry{
 const entry=parseRecordEntry(value,'project');
 if(target&&(entry.id!==target.id||entry.revision!==target.revision||target.type!=='project'))throw Error('项目保存基础与目标修订不一致。');
 return entry;
}
export function createRecordCommand(fields:RecordFields,target:RecordTarget|null,key:string,confirmed:boolean,ownerId:string):RecordCommand{
 if(confirmed!==true)throw Error('请先确认本次内容为虚构评审数据，并已核对全部字段。');
 object(fields,['title','text','occurredOn','record']);const checked=fullFields(fields),type=checked.record.type;validateIdempotencyKey(key);owner(ownerId);
 if(target&&target.type!==type)throw Error('不能更改已有记录的类别。');
 const baseline=target&&type==='project'?JSON.stringify(projectBaseline(target.baseline,target)):undefined;
 const path='/api/platform/records/'+type+(target?'/'+validateId(target.id):'');
 const body={...structuredClone(fields),confirmed:true,syntheticOnly:true,...(target?{expectedRevision:validateRevision(target.revision)}:{})};
 validateRecordCommand(type,body,!!target);
 return Object.freeze({path,method:target?'PATCH':'POST',body:JSON.stringify(body),key,ownerId,...(baseline?{baseline}:{})});
}
export function createProjectReviewCommand(entry:RecordEntry,decision:Exclude<ProjectReview['decision'],'pending'>,evidence:string,key:string,confirmed:boolean,ownerId:string):RecordCommand{
 const baseline=projectBaseline(entry);validateIdempotencyKey(key);owner(ownerId);
 const body={expectedRevision:baseline.revision,decision,evidence,confirmed,syntheticOnly:true};validateProjectReviewCommand(body);
 return Object.freeze({path:'/api/platform/records/project/'+baseline.id+'/review',method:'POST',body:JSON.stringify(body),key,ownerId,baseline:JSON.stringify(baseline)});
}
export type InspectedRecordCommand={command:RecordCommand;fields:RecordFields;target:RecordTarget|null;operation:'save'}|{command:RecordCommand;fields:RecordFields;target:RecordTarget;operation:'review';review:ProjectReview};
export function inspectRecordCommand(value:unknown):InspectedRecordCommand{
 const input=object(value,['path','method','body','key','ownerId','baseline']);if(typeof input.path!=='string'||typeof input.body!=='string'||input.body.length>500000)throw Error('待确认请求无效。');
 const match=/^\/api\/platform\/records\/(learning|career|mood|article|resource|project|training)(?:\/([0-9a-f-]+))?(\/review)?$/.exec(input.path);
 if(!match)throw Error('待确认请求目标无效。');
 let baseline:RecordEntry|undefined;
 if(input.baseline!==undefined){if(typeof input.baseline!=='string'||input.baseline.length>750000)throw Error('项目原修订无法核对。');baseline=projectBaseline(JSON.parse(input.baseline));if(JSON.stringify(baseline)!==input.baseline)throw Error('项目原修订无法核对。');}
 if(match[3]){
  if(match[1]!=='project'||!match[2]||input.method!=='POST'||!baseline)throw Error('待确认验收目标无效。');
  const body=object(JSON.parse(input.body),['expectedRevision','decision','evidence','confirmed','syntheticOnly']),review=validateProjectReviewCommand(body);
  const target={id:validateId(match[2]),revision:validateRevision(body.expectedRevision),type:'project' as const,baseline};projectBaseline(baseline,target);
  const command=createProjectReviewCommand(baseline,review.decision,body.evidence as string,validateIdempotencyKey(input.key),true,owner(input.ownerId));
  if(command.body!==input.body)throw Error('待确认验收内容无法核对。');
  return {command,fields:{title:baseline.draft.title,text:baseline.draft.text,occurredOn:baseline.draft.occurredOn,record:baseline.draft.record},target,operation:'review',review:{decision:review.decision,evidence:review.evidence}};
 }
 if(input.method!==(match[2]?'PATCH':'POST')||baseline&&!(match[1]==='project'&&match[2]))throw Error('待确认请求目标无效。');
 const body=object(JSON.parse(input.body),['title','text','occurredOn','record','confirmed','syntheticOnly',...(match[2]?['expectedRevision']:[])]);
 if(body.confirmed!==true||body.syntheticOnly!==true)throw Error('待确认请求缺少确认。');
 const fields={title:body.title,text:body.text,occurredOn:body.occurredOn,record:body.record} as RecordFields;
 const type=validateRecordType(match[1]),target=match[2]?{id:match[2],revision:validateRevision(body.expectedRevision),type,...(baseline?{baseline}:{})}:null;
 if(fields.record?.type!==type)throw Error('待确认请求类别不一致。');
 const command=createRecordCommand(fields,target,validateIdempotencyKey(input.key),true,owner(input.ownerId));
 if(command.body!==input.body)throw Error('待确认请求内容无法核对。');return {command,fields,target,operation:'save'};
}
export class RecordsClient{
 constructor(privateTransport:typeof fetch=fetch){this.transport=privateTransport;}
 private readonly transport:typeof fetch;
 private invalid(write=false,status=200){return new RecordRequestError(status,'INVALID_RESPONSE',write?'保存回执无法核对，请重试原请求。':'读取结果格式无效，请重新读取。',write);}
 private async request(path:string,command?:RecordCommand):Promise<unknown>{
  let response:Response;try{response=await this.transport(path,{method:command?.method??'GET',credentials:'same-origin',cache:'no-store',...(command?{headers:{'content-type':'application/json','idempotency-key':command.key},body:command.body}:{})});}catch{throw new RecordRequestError(0,'NETWORK_UNAVAILABLE',command?'保存结果未确认，请重试原请求。':'暂时无法读取记录，请重试。',!!command);}
  if(response.status>=500)throw new RecordRequestError(response.status,'SERVICE_UNAVAILABLE',command?'服务未确认保存结果，请重试原请求。':'记录服务暂不可用，请重试。',!!command);
  let value:unknown;try{value=await response.json();}catch{throw this.invalid(!!command,response.status);}
  if(!response.ok){if(!isObject(value)||!isObject(value.error)||typeof value.error.code!=='string'||typeof value.error.message!=='string')throw this.invalid(!!command,response.status);const code=value.error.code;throw new RecordRequestError(response.status,code,messages[code]??'请求被拒绝，请核对输入后重试。',!!command&&!rejectedBeforeWrite[response.status]?.includes(code));}
  if(!(response.status===200||!!command&&command.method==='POST'&&response.status===201))throw this.invalid(!!command,response.status);
  return value;
 }
 async identity(expectedOwner?:string):Promise<string>{
  try{const value=await this.request('/api/platform/auth/get-session');
   if(value===null)throw new RecordRequestError(401,'LOGIN_REQUIRED',messages.LOGIN_REQUIRED);
   if(!isObject(value)||!isObject(value.user)||!isObject(value.session)||value.user.id!==value.session.userId)throw this.invalid();const accountId=owner(value.user.id);if(expectedOwner!==undefined&&accountId!==owner(expectedOwner))throw new RecordRequestError(403,'ACCOUNT_CHANGED',messages.ACCOUNT_CHANGED);return accountId;
  }catch(cause){if(cause instanceof RecordRequestError&&(cause.status===401||cause.status===403))throw cause;throw new RecordRequestError(cause instanceof RecordRequestError?cause.status:0,'IDENTITY_UNAVAILABLE','暂时无法核对登录账号，请稍后重新核对访问。');}
 }
 async recover(value:RecordCommand):Promise<InspectedRecordCommand>{
  const inspected=inspectRecordCommand(value);await this.confirmIdentity(inspected.command.ownerId,true);return inspected;
 }
 private async confirmIdentity(expected:string,uncertain=false):Promise<void>{
  try{if(await this.identity()!==expected)throw new RecordRequestError(403,'ACCOUNT_CHANGED',messages.ACCOUNT_CHANGED,uncertain);}
  catch(cause){if(cause instanceof RecordRequestError)throw new RecordRequestError(cause.status,cause.code,cause.message,uncertain);throw new RecordRequestError(0,'IDENTITY_UNAVAILABLE','暂时无法核对原账号，结果尚未确认。',uncertain);}
 }
 private async read(path:string,expectedOwner?:string):Promise<unknown>{
  const accountId=await this.identity();if(expectedOwner!==undefined&&accountId!==owner(expectedOwner))throw new RecordRequestError(403,'ACCOUNT_CHANGED',messages.ACCOUNT_CHANGED);let value:unknown;try{value=await this.request(path);}catch(cause){await this.confirmIdentity(accountId);throw cause;}await this.confirmIdentity(accountId);return value;
 }
 async list(type:RecordType,expectedOwner?:string):Promise<RecordEntry[]>{
  validateRecordType(type);const value=await this.read('/api/platform/records/'+type+'?includeSynthetic=true',expectedOwner);
  try{if(!isObject(value)||!Array.isArray(value.items)||value.items.length>10000||value.dataStatus!=='isolated-test-drafts'||value.syntheticIncluded!==true)throw Error();const entries=value.items.map(item=>parseRecordEntry(item,type));if(new Set(entries.map(entry=>entry.id)).size!==entries.length)throw Error();return entries;}catch{throw this.invalid();}
 }
 async detail(type:RecordType,id:string,expectedOwner?:string):Promise<RecordEntry>{
  validateRecordType(type);id=validateId(id);const value=await this.read('/api/platform/records/'+type+'/'+id+'?includeSynthetic=true',expectedOwner);
  try{if(!isObject(value))throw Error();const entry=parseRecordEntry(value.entry,type);if(entry.id!==id)throw Error();return entry;}catch{throw this.invalid();}
 }
 async history(type:RecordType,id:string):Promise<RecordEntry[]>{
  validateRecordType(type);id=validateId(id);const value=await this.read('/api/platform/records/'+type+'/'+id+'/history?includeSynthetic=true');
  try{if(!isObject(value)||!Array.isArray(value.history)||value.limit!==100||value.history.length>100)throw Error();const entries=value.history.map(item=>parseRecordEntry(item,type));if(entries.some((entry,index)=>entry.id!==id||index>0&&entry.revision>=entries[index-1].revision))throw Error();return entries;}catch{throw this.invalid();}
 }
 async projectCandidates(type:ProjectLink['type'],query:string,expectedOwner:string):Promise<ProjectLinkCandidatesResponse>{
  if(!['todo','resource','article'].includes(type)||typeof query!=='string'||query.length>200||/[\u0000-\u001f\u007f]/.test(query))throw new RecordRequestError(400,'INVALID_PROJECT_LINK_QUERY','请核对关联类别和搜索词。');owner(expectedOwner);
  const params=new URLSearchParams({type,q:query,includeSynthetic:'true'}),value=await this.read('/api/platform/records/project-links?'+params,expectedOwner);
  try{const raw=object(value,['items','limit','truncated','observedAt','dataStatus','syntheticIncluded']);if(!Array.isArray(raw.items)||raw.items.length>50||raw.limit!==50||typeof raw.truncated!=='boolean'||!timestamp(raw.observedAt)||raw.dataStatus!=='isolated-test-drafts'||raw.syntheticIncluded!==true)throw Error();
   const items=raw.items.map(parseLinkCandidate);if(items.some(item=>item.link.type!==type)||new Set(items.map(item=>item.link.type+':'+item.link.id)).size!==items.length)throw Error();return {...raw,items} as ProjectLinkCandidatesResponse;
  }catch{throw this.invalid();}
 }
 async projectRecap(id:string,expectedOwner:string):Promise<ProjectRecapResponse>{
  id=validateId(id);owner(expectedOwner);const value=await this.read('/api/platform/records/project/'+id+'/recap?includeSynthetic=true',expectedOwner);
  try{const raw=object(value,['project','links','counts','reviewApplicable','reviewApplicability','observedAt','readOnly','aiGenerated','snapshotConsistency','freshness','dataStatus','syntheticIncluded']),project=parseRecordEntry(raw.project,'project');
   if(project.id!==id||project.draft.record.type!=='project'||!Array.isArray(raw.links)||raw.links.length>20||!timestamp(raw.observedAt)||raw.readOnly!==true||raw.aiGenerated!==false||raw.snapshotConsistency!=='owner-snapshot'||raw.freshness!=='refresh-to-check'||raw.dataStatus!=='isolated-test-drafts'||raw.syntheticIncluded!==true)throw Error();
   const pins=normalizeProjectLinks(project.draft.record.links),links=raw.links.map(value=>{const row=object(value,['link','status','current']),link=normalizeProjectLinks([row.link])[0];if(!same(link,row.link)||!['current','updated','unavailable'].includes(row.status as string))throw Error();
    const current=row.current===null?null:parseLinkCandidate(row.current);if(row.status==='unavailable'?current!==null:!current||current.link.type!==link.type||current.link.id!==link.id||current.link.sourceId!==link.sourceId||(row.status==='current'?current.link.revision!==link.revision:current.link.revision===link.revision))throw Error();return {link,status:row.status,current};});
   if(!same(links.map(row=>row.link),pins))throw Error();const counts={total:links.length,current:0,updated:0,unavailable:0,todo:0,resource:0,article:0};for(const row of links){counts[row.status as 'current'|'updated'|'unavailable']++;counts[row.link.type]++;}if(!same(raw.counts,counts))throw Error();
   const pending=project.draft.record.review.decision==='pending',stale=counts.updated+counts.unavailable>0,applicability=pending?'pending':stale?'stale-links':'current';if(raw.reviewApplicability!==applicability||raw.reviewApplicable!==(!pending&&!stale))throw Error();
   return {...raw,project,links,counts} as ProjectRecapResponse;
  }catch{throw this.invalid();}
 }
 async projectSource(input:ProjectLink,expectedOwner:string):Promise<SourceResponse>{
  const link=normalizeProjectLinks([input])[0];owner(expectedOwner);await this.confirmIdentity(expectedOwner);
  try{const value=await new SearchClient(this.transport).source(link.type==='todo'?'todo':'inbox',link.id,true);await this.confirmIdentity(expectedOwner);
   if(value.current.type!==link.type||value.current.sourceId!==link.sourceId)throw new RecordRequestError(404,'NOT_FOUND','此关联来源不可用。');return value;
  }catch(cause){await this.confirmIdentity(expectedOwner);if(cause instanceof SearchRequestError)throw new RecordRequestError(cause.status,cause.code,cause.message);throw cause;}
 }
 async send(value:RecordCommand):Promise<RecordMutationResult>{
  const inspected=inspectRecordCommand(value),{command,fields,target}=inspected;if(await this.identity()!==command.ownerId)throw new RecordRequestError(403,'ACCOUNT_CHANGED',messages.ACCOUNT_CHANGED);
  const response=await this.request(command.path,command);await this.confirmIdentity(command.ownerId,true);
  try{if(!isObject(response)||typeof response.duplicate!=='boolean')throw Error();const entry=parseRecordEntry(response.entry,fields.record.type),expected=validateRecordFields(fields);
   if(expected.record.type==='project'&&target?.baseline){
    expected.record.review=inspected.operation==='review'?inspected.review:projectReviewAfterEdit(validateRecordFields({title:target.baseline.draft.title,text:target.baseline.draft.text,occurredOn:target.baseline.draft.occurredOn,record:target.baseline.draft.record}),expected);
    if(!same(entry.source,target.baseline.source)||entry.createdAt!==target.baseline.createdAt)throw Error();
   }
   if(!same(expected,comparableDraft(entry.draft))||entry.revision!==(target?target.revision+1:1)||target&&entry.id!==target.id||!target&&!same(entry.source.original,{...fields,disposition:'reference'}))throw Error();
   return {entry,duplicate:response.duplicate};
  }catch{throw this.invalid(true);}
 }
}
