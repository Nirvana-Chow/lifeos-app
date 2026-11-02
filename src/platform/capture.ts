import type {CaptureRunProvenance} from '../capture-runs-candidate/contracts.ts';
import{PlatformError,object,validateTodo,validateInbox,validateId}from'./domain.ts';
import{aiUnavailable}from'./ai.ts';
export type CaptureKind='todo'|'life';
export type CaptureFields={title:string;body:string;date:string|null};
export type CaptureRequest={text:string;kind:CaptureKind;timeZone:string;adapter:'manual'|'synthetic-fixture'|'ai'};
export type CaptureIssue={code:string;severity:'required'|'warning'|'info';message:string};
export interface CaptureExtractor{readonly aiMode?:'synthetic-sdk-test'|'approved-live';readonly provenance?:CaptureRunProvenance;assertCurrent?(context:{signal?:AbortSignal}):Promise<void>;extract(input:CaptureRequest,context:{referenceDate:string;signal?:AbortSignal}):Promise<{fields:CaptureFields;adapter:'manual'|'synthetic-fixture-v1'|'ai-sdk-synthetic-test-v1'|'ai-sdk-ark-v1'}>}
export function checkCaptureSignal(signal?:AbortSignal):void{
 if(signal?.aborted)throw signal.reason?.name==='TimeoutError'?new PlatformError(503,'CAPTURE_PREVIEW_TIMEOUT','字段预填超时，尚未保存；已发送的请求仍可能产生费用。'):new PlatformError(499,'CAPTURE_PREVIEW_CANCELLED','字段预填已取消，尚未保存；已发送的请求仍可能产生费用。');
}
export async function waitForCaptureSignal<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
 if(signal.aborted){void work.catch(()=>{});checkCaptureSignal(signal);}let abort!:()=>void;
 try{return await Promise.race([work,new Promise<never>((_,reject)=>{abort=()=>{try{checkCaptureSignal(signal);}catch(error){reject(error);}};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();})]);}
 finally{signal.removeEventListener('abort',abort);}
}
const bad=(message:string):never=>{throw new PlatformError(400,'INVALID_CAPTURE',message);};
function checkedText(value:unknown,max:number,required=false):string{if(typeof value!=='string'||value.includes('\0')||value.length>max||required&&!value.trim())return bad('请填写有效文字，并核对长度。');return value;}
function base(value:Record<string,unknown>):CaptureRequest{
 const text=checkedText(value.text,16384,true);if(value.kind!=='todo'&&value.kind!=='life')return bad('每次只选择一条待办或生活文字记录。');
 if(value.adapter!=='manual'&&value.adapter!=='synthetic-fixture'&&value.adapter!=='ai')return bad('请选择有效的整理方式。');
 if(typeof value.timeZone!=='string'||value.timeZone.length>80)return bad('请选择有效的用户时区。');try{new Intl.DateTimeFormat('en',{timeZone:value.timeZone}).format();}catch{return bad('请选择有效的用户时区。');}
 return{text,kind:value.kind,timeZone:value.timeZone,adapter:value.adapter};
}
export function validateCaptureRequest(input:unknown):CaptureRequest{return base(object(input,['text','kind','timeZone','adapter']));}
export function referenceDate(now:Date,timeZone:string):string{const parts=new Intl.DateTimeFormat('en',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now),get=(type:string)=>parts.find(p=>p.type===type)?.value;return get('year')+'-'+get('month')+'-'+get('day');}
const nextDay=(date:string)=>new Date(new Date(date+'T12:00:00Z').valueOf()+86400000).toISOString().slice(0,10);
export const syntheticCaptureExtractor:CaptureExtractor={async extract(input,context){
 if(input.adapter==='synthetic-fixture'&&input.kind==='todo'&&input.text==='【虚构示例】明天整理读书笔记。')return{adapter:'synthetic-fixture-v1',fields:{title:'整理读书笔记',body:'明天整理读书笔记。',date:nextDay(context.referenceDate)}};
 if(input.adapter==='synthetic-fixture'&&input.kind==='life'&&input.text==='【虚构示例】今天阅读了一篇示例文章。')return{adapter:'synthetic-fixture-v1',fields:{title:'阅读记录',body:'今天阅读了一篇示例文章。',date:context.referenceDate}};
 return{adapter:'manual',fields:{title:'',body:input.text,date:null}};
}};
function fields(value:unknown,kind:CaptureKind,required:boolean):CaptureFields{
 const v=object(value,['title','body','date']),title=checkedText(v.title,240,required),body=checkedText(v.body,16384,required&&kind==='life'),date=v.date===undefined?null:v.date;
 validateTodo({title:required?title:'字段预览',notes:body,dueOn:date});return{title,body,date:date as string|null};
}
export function captureStatus(extractor:CaptureExtractor=syntheticCaptureExtractor){const mode=extractor.aiMode;return{model:{configured:mode==='approved-live',provider:mode?'volcengine-ark':null,mode:mode??null},adapters:['manual','synthetic-fixture-v1',...(mode?[mode==='approved-live'?'ai-sdk-ark-v1':'ai-sdk-synthetic-test-v1']:[])],singleItemOnly:true,notice:mode==='synthetic-sdk-test'?'仅 SDK 合成输运测试，不是真实 AI。':mode==='approved-live'?'服务端已配置预填适配器；结果仍需人工审核。':'真实 AI 未接入；不读取或保存模型密钥，不调用外部模型。'};}
export async function previewCapture(input:unknown,now=new Date(),extractor:CaptureExtractor=syntheticCaptureExtractor,context:{signal?:AbortSignal}={}){
 checkCaptureSignal(context.signal);
 const request=base(object(input,['text','kind','timeZone','adapter'])),day=referenceDate(now,request.timeZone);if(request.adapter==='ai'&&!extractor.aiMode)return aiUnavailable();let result:Awaited<ReturnType<CaptureExtractor['extract']>>;
 const selected=request.adapter==='ai'?extractor:syntheticCaptureExtractor;
 const signal=request.adapter==='ai'?AbortSignal.any([...(context.signal?[context.signal]:[]),AbortSignal.timeout(15000)]):context.signal;
 try{checkCaptureSignal(signal);const work=selected.extract(request,{referenceDate:day,signal});result=await(signal?waitForCaptureSignal(work,signal):work);checkCaptureSignal(signal);const allowed=request.adapter==='ai'?[extractor.aiMode==='approved-live'?'ai-sdk-ark-v1':'ai-sdk-synthetic-test-v1']:['manual','synthetic-fixture-v1'];if(!result||!allowed.includes(result.adapter))throw Error();result={adapter:result.adapter,fields:fields(result.fields,request.kind,false)};if(selected.assertCurrent){const checked=selected.assertCurrent({signal});await(signal?waitForCaptureSignal(checked,signal):checked);}checkCaptureSignal(signal);}catch(cause){checkCaptureSignal(signal);if(cause instanceof PlatformError){if(cause.code==='CAPTURE_PREVIEW_CANCELLED')throw new PlatformError(499,cause.code,'字段预填已取消，尚未保存；已发送的请求仍可能产生费用。');if(cause.code==='CAPTURE_PREVIEW_TIMEOUT')throw new PlatformError(503,cause.code,'字段预填超时，尚未保存；已发送的请求仍可能产生费用。');if(cause.code==='CAPTURE_CONFIGURATION_CHANGED')throw new PlatformError(409,cause.code,'模型配置已变化，请重新读取配置后再预填；尚未保存记录。');}throw new PlatformError(503,'CAPTURE_PREVIEW_UNAVAILABLE','字段预览暂不可用，可以返回手工填写；尚未保存记录。');}
 const issues:CaptureIssue[]=[];
 if(!result.fields.title.trim())issues.push({code:'MISSING_TITLE',severity:'required',message:'标题尚未填写，请人工补充。'});
 if(request.kind==='life'&&!result.fields.body.trim())issues.push({code:'MISSING_BODY',severity:'required',message:'生活记录正文尚未填写。'});
 if(!result.fields.date)issues.push({code:'UNKNOWN_DATE',severity:'info',message:'日期未提供，保存为未知；不会自动填成今天。'});
 if(request.text.split(/\n|；|;/).filter(v=>v.trim()).length>1)issues.push({code:'POSSIBLE_MULTIPLE_ITEMS',severity:'warning',message:'可能包含多件事，请先拆开或只整理其中一条；本次不会批量入库。'});
 issues.push({code:'HUMAN_REVIEW_REQUIRED',severity:'info',message:'格式检查不代表事实完整或正确，请核对字段；原文会独立保留。'});
 return{fields:result.fields,adapter:result.adapter,referenceDate:day,timeZone:request.timeZone,issues,model:{configured:request.adapter==='ai'&&extractor.aiMode==='approved-live',mode:request.adapter==='ai'?extractor.aiMode:null},singleItemOnly:true};
}
export function validateCaptureConfirmation(input:unknown){
 const raw=structuredClone(object(input,['text','kind','timeZone','adapter','fields','confirmed','singleItem','syntheticOnly','runId'])),request=base(raw);
 if(raw.confirmed!==true||raw.singleItem!==true||raw.syntheticOnly!==true)return bad('需要明确核对一条虚构测试记录并确认保存。');
 if(raw.runId!==undefined)validateId(raw.runId);
 const accepted=fields(raw.fields,request.kind,true),kind=request.kind==='todo'?'todo':'inbox',draft=kind==='todo'?validateTodo({title:accepted.title,notes:accepted.body,dueOn:accepted.date,status:'open'}):validateInbox({title:accepted.title,text:accepted.body,occurredOn:accepted.date,disposition:'reference'});
 return{raw,kind,draft,original:{inputText:request.text,acceptedFields:accepted,capture:{workflow:'single-record-v1',kind:request.kind,timeZone:request.timeZone,requestedAdapter:request.adapter,realModelConfigured:request.adapter==='ai'?null:false,modelRunVerified:false,confirmedByUser:true,...(raw.runId!==undefined?{runId:raw.runId}:{})}}}as const;
}
