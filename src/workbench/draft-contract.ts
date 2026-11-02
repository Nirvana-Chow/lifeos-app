import{validateTodo,validateInbox}from'../platform/domain.ts';
import{validateRecordMetadata}from'../records-candidate/domain.ts';
import{validateCalendarDraft}from'../calendar-candidate/domain.ts';
import{draftFromFields,type FinanceFields}from'../finance-workbench/fields.ts';
import{publicAIConfigSchema}from'../platform/ai-settings-contract.ts';
export type DraftKind='journal'|'mood'|'todo'|'calendar'|'training'|'finance'|'learning'|'project'|'career'|'article'|'resource'|'ai';
export type DraftValues=Record<string,string>;
export type DraftField={name:string;label:string;type?:'textarea'|'date'|'number'|'select';options?:readonly(readonly[string,string])[];required?:boolean;readOnly?:boolean;max?:number};
const field=(name:string,label:string,type?:DraftField['type'],required=false,options?:DraftField['options']):DraftField=>({name,label,type,required,options});
const title=field('title','标题',undefined,true),body=field('text','正文 / 原文','textarea'),date=field('occurredOn','发生日期（未知留空）','date');
const statusOptions=[['planned','计划'],['active','进行中'],['done','完成']]as const;
export const draftTitles:Record<DraftKind,string>={journal:'日记',mood:'心情记录',todo:'待办',calendar:'日程',training:'训练实绩',finance:'财务流水',learning:'学习记录',project:'项目',career:'职业成果',article:'文章',resource:'资料索引',ai:'AI 服务配置'};
export function draftFields(kind:DraftKind,values:DraftValues={}):DraftField[]{
 switch(kind){
 case'todo':return[title,field('notes','说明','textarea'),field('dueOn','期限（未知留空）','date'),field('status','状态','select',true,[['open','待办'],['in_progress','进行中'],['done','已完成'],['cancelled','取消']])];
 case'calendar':return[title,field('notes','内容','textarea'),field('scheduleKind','安排方式','select',true,[['all-day','全天'],['timed','定时']]),...(values.scheduleKind==='timed'?[field('startAt','开始时刻（含 Z 或 +08:00）',undefined,true),field('endAt','结束时刻（含 Z 或 +08:00）',undefined,true),field('timeZone','时区（如 Asia/Shanghai）',undefined,true)]:[field('startDate','开始日期','date',true),field('endDate','结束日期（不含当天）','date',true)])];
 case'finance':return[field('kind','流水类型','select',true,[['expense','支出'],['income','收入'],['refund','退款'],['transfer','转账'],['repayment','还款']]),field('amount','金额（元）',undefined,true),{...field('currency','币种'),readOnly:true},field('occurredOn','交易日期','date',true),field('category','分类（未知留空）'),...(!['income','refund'].includes(values.kind)?[field('fromAccountRef','来源账户引用')]:[]),...(values.kind!=='expense'?[field('toAccountRef','目标账户引用')]:[]),...(values.kind==='refund'?[field('originalEntryId','原流水 ID',undefined,true)]:[]),field('notes','备注','textarea')];
 case'ai':return[{...field('provider','服务商'),readOnly:true},{...field('baseURL','接口地址'),readOnly:true},field('model','模型 ID',undefined,true),{...field('dataScope','读取范围'),readOnly:true},field('budget','月预算参考（元，非硬限额）')];
 default:{
 const base=[title,body,date];
 if(kind==='journal')return[{...title},field('text','正文 / 原文','textarea',true),date];
 if(kind==='training')return[...base,field('exercise','动作名称（未知留空）')];
 if(kind==='mood')return[...base,field('label','自报心情',undefined,true),field('intensity','自报强度（1–5，未知留空）','number')];
 if(kind==='learning')return[...base,field('topic','学习方向',undefined,true),field('status','进度','select',true,statusOptions),field('nextStep','下一步','textarea'),field('resourceURL','资源链接')];
 if(kind==='career')return[...base,field('evidence','成果依据','textarea',true),field('nextStep','下一步','textarea')];
 if(kind==='project')return[...base,field('stage','项目阶段','select',true,[['idea','想法'],['planned','计划'],['active','进行中'],['paused','暂停'],['closed','结束']]),field('nextStep','下一步','textarea'),field('completion','自报完成情况','select',true,[['not-complete','未完成'],['complete','自报完成']]),field('completionEvidence','完成证据','textarea'),field('testing','人工记录的测试结果','select',true,[['not-run','未测试'],['passed','通过'],['failed','失败'],['blocked','阻塞']]),field('testEvidence','测试依据','textarea')];
 if(kind==='article')return[...base,field('author','作者（未知留空）'),field('attribution','内容归属','select',true,[['original','原创'],['excerpt','摘录'],['summary','摘要']]),field('sourceURL','原文链接')];
 return[...base,field('url','原始链接',undefined,true),field('author','作者（未知留空）')];
 }
 }
}
export function emptyDraft(kind:DraftKind):DraftValues{return Object.fromEntries(draftFields(kind).map(f=>[f.name,kind==='finance'&&f.name==='currency'?'CNY':kind==='ai'?({provider:'火山引擎方舟',baseURL:'https://ark.cn-beijing.volces.com/api/v3',dataScope:'仅当前消息'}as Record<string,string>)[f.name]??'':'' ]));}
export type TrainingRow={reps:string;weight:string;weightUnit:string;duration:string;durationUnit:string};
export const emptyTrainingRow=():TrainingRow=>({reps:'',weight:'',weightUnit:'',duration:'',durationUnit:''});
function optional(v:string|undefined){return v?.trim()||null;}
function number(v:string){if(!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v))throw Error('数值需要明确的非负数字。');return Number(v);}
/** Local validation only. Reuses candidate DTO rules; never constructs a command,
 * owner, source ID, acceptance claim, saved record or network request. */
export function inspectDraft(kind:DraftKind,v:DraftValues,rows:TrainingRow[]=[]):unknown{
 for(const f of draftFields(kind,v))if(f.required&&!v[f.name]?.trim())throw Error('请填写'+f.label+'。');
 if(kind==='todo')return validateTodo({title:v.title,notes:v.notes??'',dueOn:optional(v.dueOn),status:v.status});
 if(kind==='calendar')return validateCalendarDraft({title:v.title,notes:v.notes??'',schedule:v.scheduleKind==='timed'?{kind:'timed',startAt:v.startAt,endAt:v.endAt,timeZone:v.timeZone}:{kind:'all-day',startDate:v.startDate,endDate:v.endDate}});
 if(kind==='finance'){if(v.currency!=='CNY')throw Error('本候选仅接受明确的 CNY 币种。');if(v.kind==='expense'&&v.toAccountRef||['income','refund'].includes(v.kind)&&v.fromAccountRef)throw Error('账户方向与流水类型不一致，请核对。');return draftFromFields({kind:v.kind,amount:v.amount,occurredOn:v.occurredOn,originalEntryId:v.kind==='refund'?v.originalEntryId??'':'',category:v.category??'',fromAccountRef:v.fromAccountRef??'',toAccountRef:v.toAccountRef??'',notes:v.notes??''}as FinanceFields);}
 if(kind==='ai'){
  if(v.budget&&!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(v.budget))throw Error('预算使用非负金额，最多两位小数。');
  const parsed=publicAIConfigSchema.safeParse({provider:'volcengine-ark',baseURL:'https://ark.cn-beijing.volces.com/api/v3',model:v.model,dataScope:'current-message-only',monthlyBudgetMinor:v.budget?Math.round(Number(v.budget)*100):null});
  if(!parsed.success)throw Error(parsed.error.issues[0]?.message??'请核对配置。');return parsed.data;
 }
 const common={title:v.title,text:v.text??'',occurredOn:optional(v.occurredOn),disposition:'reference'};
 validateInbox(common);if(kind==='journal'){if(!common.text.trim())throw Error('请填写正文。');return common;}
 const nullable=(key:string)=>optional(v[key]);
 const extra:Record<string,unknown>=kind==='training'?{exercise:nullable('exercise'),sets:rows.map(r=>({reps:r.reps===''?null:number(r.reps),weight:r.weight===''?null:{value:number(r.weight),unit:r.weightUnit},duration:r.duration===''?null:{value:number(r.duration),unit:r.durationUnit}}))}:kind==='mood'?{label:v.label,intensity:v.intensity?number(v.intensity):null}:kind==='learning'?{topic:v.topic,status:v.status,nextStep:nullable('nextStep'),resourceURL:nullable('resourceURL')}:kind==='career'?{evidence:v.evidence,nextStep:nullable('nextStep')}:kind==='article'?{author:nullable('author'),attribution:v.attribution,sourceURL:nullable('sourceURL')}:kind==='resource'?{url:v.url,author:nullable('author')}:{stage:v.stage,nextStep:nullable('nextStep'),completion:{selfReported:true,status:v.completion,evidence:nullable('completionEvidence')},testing:{manuallyRecorded:true,outcome:v.testing,evidence:nullable('testEvidence')},review:{decision:'pending',evidence:null},links:[]};
 const metadata=validateRecordMetadata({type:kind,syntheticOnly:true,...extra});return{...common,record:metadata};
}
