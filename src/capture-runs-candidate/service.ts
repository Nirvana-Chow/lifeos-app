import {createHash} from 'node:crypto';
import {PlatformError,validateId,validateIdempotencyKey} from '../platform/domain.ts';
import {checkCaptureSignal,waitForCaptureSignal,validateCaptureRequest,validateCaptureConfirmation,type CaptureRequest,type CaptureExtractor} from '../platform/capture.ts';
import type {MutationResult} from '../platform/contracts.ts';
import type {CaptureRun,CaptureRunRepository,CaptureRunEvidence} from './contracts.ts';
import {checkedCaptureRun,captureRunProvenanceSchema} from './repository.ts';
const canonical=(v:unknown):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}':JSON.stringify(v);
const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
const conflict=()=>new PlatformError(409,'CAPTURE_RUN_CONFLICT','运行凭证状态已变化，请核对原请求；不会自动重新调用模型。');
const missing=()=>new PlatformError(404,'CAPTURE_RUN_NOT_FOUND','没有可访问的运行凭证。');
export class CaptureRunsService{
 private repository:CaptureRunRepository;constructor(repository:CaptureRunRepository){this.repository=repository;}
 private next(run:CaptureRun,change:Partial<CaptureRun>):CaptureRun{return checkedCaptureRun(run.ownerId,{...run,...change,revision:run.revision+1,updatedAt:new Date(Math.max(Date.now(),Date.parse(run.updatedAt))).toISOString()},run.id);}
 async get(owner:string,id:string):Promise<CaptureRun>{id=validateId(id);const row=await this.repository.get(owner,id);if(!row)throw missing();return checkedCaptureRun(owner,row,id);}
 async start(owner:string,id:string,input:CaptureRequest,extractor?:CaptureExtractor):Promise<CaptureRun>{
  id=validateId(id);const request=validateCaptureRequest(input),provenance=request.adapter==='ai'?captureRunProvenanceSchema.safeParse(extractor?.provenance):null;
  if(provenance&&!provenance.success||request.adapter==='ai'&&extractor?.aiMode!==provenance?.data?.mode)throw new PlatformError(503,'CAPTURE_RUN_UNAVAILABLE','无法核对服务端模型版本，尚未运行预填。');
  const now=new Date().toISOString(),row:CaptureRun={id,ownerId:owner,revision:1,state:'pending',kind:request.kind,adapter:request.adapter,sourceHash:digest(request),provenance:provenance?.data??null,createdAt:now,updatedAt:now,confirmationHash:null,record:null};
  return checkedCaptureRun(owner,await this.repository.change(owner,id,prior=>{if(prior)throw conflict();return checkedCaptureRun(owner,row,id);}),id);
 }
 async finish(owner:string,id:string,state:'ready'|'failed'|'cancelled'|'configuration-changed'):Promise<CaptureRun>{
  return checkedCaptureRun(owner,await this.repository.change(owner,id,raw=>{if(!raw)throw missing();const run=checkedCaptureRun(owner,raw,id);if(run.state!=='pending'&&!(run.state==='ready'&&state!=='ready'))return run;return this.next(run,{state});}),id);
 }
 async cancel(owner:string,id:string):Promise<CaptureRun>{
  id=validateId(id);return checkedCaptureRun(owner,await this.repository.change(owner,id,raw=>{if(!raw)throw missing();const run=checkedCaptureRun(owner,raw,id);if(run.state==='cancelled')return run;if(run.state!=='pending'&&run.state!=='ready')throw conflict();return this.next(run,{state:'cancelled'});}),id);
 }
 async beginConfirmation(owner:string,input:unknown,key:string,current:()=>Promise<CaptureExtractor|undefined>,signal:AbortSignal):Promise<CaptureRunEvidence>{
  checkCaptureSignal(signal);
  validateIdempotencyKey(key);const value=validateCaptureConfirmation(input),id=value.raw.runId;if(typeof id!=='string')throw conflict();
  const run=await waitForCaptureSignal(this.get(owner,id),signal);checkCaptureSignal(signal);const request=validateCaptureRequest({text:value.raw.text,kind:value.raw.kind,timeZone:value.raw.timeZone,adapter:value.raw.adapter}),hash=digest({key,body:value.raw});
  if(run.sourceHash!==digest(request))throw conflict();
  if(run.state==='ready'&&run.adapter==='ai'){
   try{const extractor=await waitForCaptureSignal(current(),signal);checkCaptureSignal(signal);if(!extractor||canonical(extractor.provenance)!==canonical(run.provenance)||extractor.aiMode!==run.provenance?.mode)throw Error();if(extractor.assertCurrent)await waitForCaptureSignal(extractor.assertCurrent({signal}),signal);checkCaptureSignal(signal);}
   catch{checkCaptureSignal(signal);await this.repository.change(owner,id,raw=>{if(!raw)throw missing();const latest=checkedCaptureRun(owner,raw,id);return latest.state==='ready'?this.next(latest,{state:'configuration-changed'}):latest;});throw new PlatformError(409,'CAPTURE_CONFIGURATION_CHANGED','模型配置已变化，请重新预填；尚未发送本次保存。');}
  }
  const locked=checkedCaptureRun(owner,await this.repository.change(owner,id,raw=>{
   checkCaptureSignal(signal);if(!raw)throw missing();const latest=checkedCaptureRun(owner,raw,id);
   if(latest.state==='confirmation-pending'||latest.state==='confirmed'){if(latest.confirmationHash!==hash)throw conflict();return latest;}
   if(latest.state!=='ready')throw conflict();return this.next(latest,{state:'confirmation-pending',confirmationHash:hash});
  }),id);
  return{id:locked.id,sourceHash:locked.sourceHash,provenance:structuredClone(locked.provenance)};
 }
 async confirmed(owner:string,id:string,result:MutationResult):Promise<CaptureRun>{
  return checkedCaptureRun(owner,await this.repository.change(owner,id,raw=>{if(!raw)throw missing();const run=checkedCaptureRun(owner,raw,id),entry=result.entry,record={kind:entry.kind as 'todo'|'inbox',id:entry.id,sourceId:entry.source.id,revision:1 as const};
   const source=entry.source.original as {capture?:{runReceipt?:unknown}};if(canonical(source?.capture?.runReceipt)!==canonical({id:run.id,sourceHash:run.sourceHash,provenance:run.provenance}))throw conflict();
   if(run.state==='confirmed'){if(canonical(run.record)!==canonical(record))throw conflict();return run;}
   if(run.state!=='confirmation-pending'||entry.revision!==1||entry.kind!==(run.kind==='todo'?'todo':'inbox'))throw conflict();return this.next(run,{state:'confirmed',record});
  }),id);
 }
}
