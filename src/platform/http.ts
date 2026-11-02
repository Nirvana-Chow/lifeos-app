import {handleRecordWindowRequest} from './window-http.ts';
import {inspectSnapshotCompatibility} from './data-compatibility.ts';
import {handleFinanceComparisonRequest} from '../finance-candidate/http.ts';
import {CaptureRunsService} from '../capture-runs-candidate/service.ts';
import type {CaptureRunRepository} from '../capture-runs-candidate/contracts.ts';
import {publicCaptureRun} from '../capture-runs-candidate/repository.ts';
import{previewCapture,validateCaptureRequest,captureStatus,checkCaptureSignal,waitForCaptureSignal,type CaptureExtractor}from'./capture.ts';
import{aiStatus}from'./ai.ts';
import{handleChatRequest}from'../chat-candidate/http.ts';import type{ChatService}from'../chat-candidate/service.ts';
import{handleAISettings}from'./ai-settings-http.ts';import type{AISettingsService}from'./ai-settings-service.ts';
import{JournalService}from'../journal-candidate/service.ts';import{handleJournal}from'../journal-candidate/http.ts';
import{handleCalendar}from'../calendar-candidate/http.ts';import type{CalendarService}from'../calendar-candidate/service.ts';
import{RecordsService}from'../records-candidate/service.ts';import{handleRecords}from'../records-candidate/http.ts';
import{handleSearchRequest}from'../search-candidate/http.ts';
import{handleTimelineRequest}from'../timeline-candidate/http.ts';
import{handleImportPreview}from'../import-preview/http.ts';
import {assertLocalRequest,readJSONBody} from './request-boundary.ts';
import {PlatformError,object} from './domain.ts';import {DraftService} from './service.ts';import {requirements} from './requirements.ts';
import type {PlatformRepository,SessionReader,Kind,PublicEntry} from './contracts.ts';
type Options={legacyUnboundedReadsEnabled?:boolean;trainingWritesEnabled?:boolean;repository:PlatformRepository;sessions:SessionReader;baseURL:string;owner:{id:string;email:string};now?:()=>Date;captureExtractor?:CaptureExtractor;storageVerified?:boolean;aiSettings?:AISettingsService;aiSettingsUnavailableReason?:string;calendar?:CalendarService;chat?:ChatService;captureRuns?:CaptureRunRepository};
const respond=(value:unknown,status=200,extra:Record<string,string>={})=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie',...extra}});
export function createPlatformHandler(options:Options):(request:Request)=>Promise<Response>{
 const service=new DraftService(options.repository,{trainingWritesEnabled:options.trainingWritesEnabled}),journal=new JournalService(service),records=new RecordsService(service),base=new URL(options.baseURL),runs=options.captureRuns?new CaptureRunsService(options.captureRuns):undefined;
 return async request=>{
  try{
   const url=new URL(request.url);assertLocalRequest(request,options.baseURL);
   let principal;try{principal=await options.sessions.read(request.headers);}catch{throw new PlatformError(503,'AUTH_UNAVAILABLE','身份服务暂不可用。');}
   if(!principal)throw new PlatformError(401,'LOGIN_REQUIRED','请先登录。');
   if(principal.userId!==options.owner.id||principal.email.toLowerCase()!==options.owner.email.toLowerCase())throw new PlatformError(403,'ACCOUNT_NOT_ALLOWED','该账号没有访问此候选的权限。');
   if(!options.legacyUnboundedReadsEnabled&&/^\/api\/platform\/(search|timeline)(?:\/compare)?\/?$/.test(url.pathname))return respond({error:{code:'LEGACY_UNBOUNDED_READ_DISABLED',message:'旧全量扫描入口已关闭，请使用有界分页。'}},410);
   const timelineResponse=await handleTimelineRequest(service,options.calendar,principal.userId,request,url,options.now);if(timelineResponse)return timelineResponse;
   const searchResponse=await handleSearchRequest(service,options.calendar,principal.userId,request,url);if(searchResponse)return searchResponse;
   const recordsResponse=await handleRecords(request,principal.userId,options.baseURL,records);if(recordsResponse)return recordsResponse;
   const importResponse=await handleImportPreview(request,principal.userId,options.baseURL,service);if(importResponse)return importResponse;
   const journalResponse=await handleJournal(request,principal.userId,options.baseURL,journal);if(journalResponse)return journalResponse;
   const calendarResponse=await handleCalendar(request,principal.userId,options.baseURL,options.calendar);if(calendarResponse)return calendarResponse;
   const settingsPrincipal=principal;
   const assertOwner=async(signal:AbortSignal)=>{
    let current;try{current=await waitForCaptureSignal(options.sessions.read(request.headers),signal);}catch{if(signal.aborted)throw signal.reason;throw new PlatformError(503,'AUTH_UNAVAILABLE','身份服务暂不可用。');}
    if(!current)throw new PlatformError(401,'LOGIN_REQUIRED','请先恢复原账号。');if(current.userId!==settingsPrincipal.userId||current.email.toLowerCase()!==settingsPrincipal.email.toLowerCase())throw new PlatformError(403,'ACCOUNT_NOT_ALLOWED','账号已变化，请恢复原账号。');
   };
   const recordWindow=await handleRecordWindowRequest(request,principal.userId,options.repository,assertOwner,options.now);if(recordWindow)return recordWindow;
   const financeComparison=await handleFinanceComparisonRequest(service,principal.userId,request,{assertOwner},options.now);if(financeComparison)return financeComparison;
   const settingsResponse=await handleAISettings(request,principal.userId,options.baseURL,options.aiSettings,options.aiSettingsUnavailableReason,{assertOwner});if(settingsResponse)return settingsResponse;
   const chatResponse=await handleChatRequest(request,principal.userId,options.baseURL,options.chat,{assertOwner});if(chatResponse)return chatResponse;
   if(url.pathname==='/api/platform/status'){
    if(request.method!=='GET')return respond({error:{code:'METHOD_NOT_ALLOWED',message:'连接状态只读。'}},405,{Allow:'GET'});
    let ai={configured:false,settingsPersistable:false,secretStoreReady:false,externalCallsEnabled:false};
    // AI extension failure must not hide the independent core storage status.
    if(options.aiSettings)try{const v=await options.aiSettings.view(principal.userId);ai={configured:v.realModelActive,settingsPersistable:v.capabilities.configurationWritable,secretStoreReady:v.capabilities.secretWritable,externalCallsEnabled:v.realModelActive};}catch{/* unavailable remains explicit and closed */}
    return respond({scope:'isolated-synthetic-review',personalAccountReady:false,personalDataAuthorized:false,storage:{type:'postgresql',schemaVersion:2,restrictedRoleVerified:options.storageVerified===true},features:{training:{readable:true,writesEnabled:options.trainingWritesEnabled===true,activationRequiresAcceptance:true}},extensions:{calendar:{configured:!!options.calendar,restrictedRoleVerified:!!options.calendar&&options.storageVerified===true},chat:{configured:!!options.chat,restrictedRoleVerified:!!options.chat&&options.storageVerified===true}},ai});
   }
   if(/^\/api\/platform\/ai\/status\/?$/.test(url.pathname)){if(request.method!=='GET')return respond({error:{code:'METHOD_NOT_ALLOWED',message:'AI状态只读。'}},405,{Allow:'GET'});return respond(aiStatus(options.aiSettings?await options.aiSettings.view(principal.userId):undefined));}
   const runPath=/^\/api\/platform\/capture\/runs\/([^/]+)(\/cancel)?\/?$/.exec(url.pathname);
   if(runPath){
    if(url.search||request.method==='GET'&&request.body!==null)throw new PlatformError(400,'INVALID_CAPTURE_RUN_QUERY','运行凭证查询不接受附加条件。');
    const method=runPath[2]?'POST':'GET';if(request.method!==method)return respond({error:{code:'METHOD_NOT_ALLOWED',message:'此运行凭证操作不支持该方法。'}},405,{Allow:method});
    if(!runs)throw new PlatformError(503,'CAPTURE_RUN_UNAVAILABLE','运行凭证存储尚未启用。');
    if(method==='POST'){if(request.headers.get('origin')!==base.origin)throw new PlatformError(403,'ORIGIN_DENIED','取消需要相同来源。');object(await readJSONBody(request),[]);}
    const runSignal=AbortSignal.any([request.signal,AbortSignal.timeout(15000)]);await assertOwner(runSignal);const run=await waitForCaptureSignal(method==='GET'?runs.get(principal.userId,runPath[1]):runs.cancel(principal.userId,runPath[1]),runSignal);await assertOwner(runSignal);checkCaptureSignal(runSignal);return respond({run:publicCaptureRun(run)});
   }
   const capture=/^\/api\/platform\/capture\/(status|preview|confirm)\/?$/.exec(url.pathname);
   if(capture){
    const action=capture[1],method=action==='status'?'GET':'POST';if(request.method!==method)return respond({error:{code:'METHOD_NOT_ALLOWED',message:'此输入操作不支持该方法。'}},405,{Allow:method});
    if(action==='status'){
     try{return respond({...captureStatus(options.aiSettings?await options.aiSettings.captureExtractor(principal.userId):options.captureExtractor),runReceipts:{available:!!runs}});}
     catch{const fallback=captureStatus();return respond({...fallback,runReceipts:{available:!!runs},model:{...fallback.model,configurationStatus:'unavailable'},notice:'模型配置暂不可用；仍可使用手工录入。'});}
    }
    if(request.headers.get('origin')!==base.origin)throw new PlatformError(403,'ORIGIN_DENIED','写入或预览需要相同来源。');const body=await readJSONBody(request);
    const captureSignal=AbortSignal.any([request.signal,AbortSignal.timeout(15000)]),originalPrincipal=principal;
    const recheckCaptureOwner=async()=>{
     checkCaptureSignal(captureSignal);let current;
     try{current=await waitForCaptureSignal(options.sessions.read(request.headers),captureSignal);}catch{checkCaptureSignal(captureSignal);throw new PlatformError(503,'AUTH_UNAVAILABLE','身份服务暂不可用。');}
     checkCaptureSignal(captureSignal);if(!current)throw new PlatformError(401,'LOGIN_REQUIRED','请先恢复原账号。');
     if(current.userId!==originalPrincipal.userId||current.email.toLowerCase()!==originalPrincipal.email.toLowerCase())throw new PlatformError(403,'ACCOUNT_NOT_ALLOWED','账号已变化，请恢复原账号。');
    };
    await recheckCaptureOwner();
    if(action==='preview'){
     const raw=object(body,['text','kind','timeZone','adapter','runId']),{runId,...fields}=raw,input=validateCaptureRequest(fields),requestedAI=input.adapter==='ai';
     if(runId!==undefined&&!runs)throw new PlatformError(503,'CAPTURE_RUN_UNAVAILABLE','运行凭证存储尚未启用；可以使用不带凭证的原有整理方式。');
     const extractor=requestedAI&&options.aiSettings?await waitForCaptureSignal(options.aiSettings.captureExtractor(originalPrincipal.userId),captureSignal):options.captureExtractor;
     await recheckCaptureOwner();
     const run=runId!==undefined?await runs!.start(principal.userId,runId as string,input,extractor):undefined;
     try{
      if(run)await recheckCaptureOwner();
      const preview=await previewCapture(input,options.now?.()??new Date(),extractor,{signal:captureSignal});
      await recheckCaptureOwner();
      if(requestedAI&&extractor?.assertCurrent)await waitForCaptureSignal(extractor.assertCurrent({signal:captureSignal}),captureSignal);
      checkCaptureSignal(captureSignal);
      const receipt=run?await runs!.finish(principal.userId,run.id,'ready'):undefined;
      if(receipt&&receipt.state!=='ready')throw new PlatformError(499,'CAPTURE_PREVIEW_CANCELLED','本次预填已取消，尚未保存。');
      await recheckCaptureOwner();if(requestedAI&&extractor?.assertCurrent)await waitForCaptureSignal(extractor.assertCurrent({signal:captureSignal}),captureSignal);checkCaptureSignal(captureSignal);
      return respond({preview:{...preview,...(receipt?{run:publicCaptureRun(receipt)}:{})}});
     }catch(error){
      if(run){const state=captureSignal.aborted||error instanceof PlatformError&&error.code==='CAPTURE_PREVIEW_CANCELLED'?'cancelled':error instanceof PlatformError&&error.code==='CAPTURE_CONFIGURATION_CHANGED'?'configuration-changed':'failed';await runs!.finish(principal.userId,run.id,state);}
      throw error;
     }
    }
    // Metadata and business storage use separate transactions. Keep the exact
    // original command through uncertainty; a receipt replay repairs its link.
    const runId=body&&typeof body==='object'&&'runId'in body?body.runId:undefined;
    if(runId!==undefined&&!runs)throw new PlatformError(503,'CAPTURE_RUN_UNAVAILABLE','运行凭证暂不可核对，请保留原保存请求。');
    const evidence=runId!==undefined?await runs!.beginConfirmation(principal.userId,body,request.headers.get('idempotency-key')??'',async()=>options.aiSettings?options.aiSettings.captureExtractor(principal.userId):options.captureExtractor,captureSignal):undefined;
    try{await recheckCaptureOwner();}catch(error){if(evidence)throw new PlatformError(503,'CAPTURE_CONFIRMATION_UNCERTAIN','确认命令已保留，请恢复原账号后重试同一请求。');throw error;}
    const result=await service.captureConfirmed(principal.userId,body,request.headers.get('idempotency-key')??'',evidence);
    if(evidence)await runs!.confirmed(principal.userId,evidence.id,result);
    return respond(result,result.duplicate?200:201);
   }
   const path=/^\/api\/platform\/(requirements|todos|finance|inbox|export)(?:\/([^/]+))?(?:\/(to-todo|history))?\/?$/.exec(url.pathname);
   if(!path)throw new PlatformError(404,'NOT_FOUND','接口不存在。');
   const resource=path[1],id=path[2]??null,action=path[3]??null;
   const visible=(entry:PublicEntry)=>resource!=='inbox'||url.searchParams.get('includeSynthetic')==='true'||!('record' in entry.draft);
   if(resource==='export'){if(id||action)throw new PlatformError(404,'NOT_FOUND','接口不存在。');if(request.method!=='GET')return respond({error:{code:'METHOD_NOT_ALLOWED',message:'导出只读。'}},405,{Allow:'GET'});const snapshot=await service.exportSnapshot(principal.userId),calendar=options.calendar?{status:'included',...await options.calendar.exportSnapshot(principal.userId)}:{status:'not-configured'};return respond({format:'lifeos.review.export.v2',scope:'isolated-synthetic',exportedAt:new Date().toISOString(),requirementsVersion:requirements().baselineVersion,...snapshot,dataCompatibility:inspectSnapshotCompatibility(snapshot),extensions:{calendar},snapshotConsistency:'per-adapter-transactions',aiSecretsIncluded:false,backupOrRestoreVerified:false},200,{'Content-Disposition':'attachment; filename="lifeos-review-export.json"'});}
   if(action==='history'){
    if(!id||resource==='requirements')throw new PlatformError(404,'NOT_FOUND','接口不存在。');
    if(request.method!=='GET')return respond({error:{code:'METHOD_NOT_ALLOWED',message:'历史只读。'}},405,{Allow:'GET'});
    if(resource==='inbox'&&!visible(await service.get(principal.userId,'inbox',id)))throw new PlatformError(404,'NOT_FOUND','没有可访问的记录。');
    return respond({history:(await service.history(principal.userId,resource==='todos'?'todo':resource==='inbox'?'inbox':'finance',id)).filter(visible),limit:100});
   }
   if(action){if(resource!=='inbox'||!id)throw new PlatformError(404,'NOT_FOUND','接口不存在。');if(request.method!=='POST')return respond({error:{code:'METHOD_NOT_ALLOWED',message:'需要确认操作。'}},405,{Allow:'POST'});if(request.headers.get('origin')!==base.origin)throw new PlatformError(403,'ORIGIN_DENIED','写入需要相同来源。');const result=await service.createTodoFromInbox(principal.userId,id,await readJSONBody(request),request.headers.get('idempotency-key')??'');return respond(result,result.duplicate?200:201);}

   if(resource==='requirements'){
    if(id)throw new PlatformError(404,'NOT_FOUND','接口不存在。');
    if(request.method!=='GET')return respond({error:{code:'METHOD_NOT_ALLOWED',message:'此需求基线为只读。'}},405,{Allow:'GET'});
    return respond({baseline:requirements()});
   }
   const kind:Kind=resource==='todos'?'todo':resource==='inbox'?'inbox':'finance';
   if(request.method==='GET'){
    if(id){const entry=await service.get(principal.userId,kind,id);if(!visible(entry))throw new PlatformError(404,'NOT_FOUND','没有可访问的记录。');return respond({entry});}
    return respond({items:(await service.list(principal.userId,kind)).filter(visible),dataStatus:'isolated-test-drafts'});
   }
   if((request.method==='POST'&&!id)||(request.method==='PATCH'&&id)){
    if(request.headers.get('origin')!==base.origin)throw new PlatformError(403,'ORIGIN_DENIED','写入需要相同来源。');
    const result=await service.mutate(principal.userId,kind,id,await readJSONBody(request),request.headers.get('idempotency-key')??'');
    return respond(result,request.method==='POST'&&!result.duplicate?201:200);
   }
   return respond({error:{code:'METHOD_NOT_ALLOWED',message:'此操作未开放。'}},405,{Allow:id?'GET, PATCH':'GET, POST'});
  }catch(e){return e instanceof PlatformError?respond({error:{code:e.code,message:e.message}},e.status):respond({error:{code:'STORAGE_UNAVAILABLE',message:'候选存储暂不可用，未确认本次保存。'}},503);}
 };
}
