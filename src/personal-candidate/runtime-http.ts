import {PersonalFinanceService} from '../personal-finance/service.ts';
import type {FileHandoffRuntime} from '../file-handoff/runtime.ts';
import {handleFileHandoffRequest} from '../file-handoff/http.ts';
import {handlePersonalFinance} from '../personal-finance/http.ts';
import {PersonalCalendarService} from '../calendar-candidate/personal-service.ts';
import {handlePersonalCalendar} from '../calendar-candidate/personal-http.ts';
import {handleRequirementsRequest} from '../requirements-candidate/http.ts';
import {handleRequirementSupportRequest} from '../requirement-support-candidate/http.ts';
import {handleStorageReviewRequest} from '../storage-review/http.ts';
import {StorageReviewService} from '../storage-review/service.ts';
import {readReleaseArtifact,type ReleaseArtifact} from '../release-notes-candidate/runtime.ts';
import type {AuthorityService} from '../agent-authority/service.ts';
import type {ClassificationService} from './classification-service.ts';
import {handleOwnerClassificationRequest} from './classification-http.ts';
import {createHash} from 'node:crypto';
import type {PlatformRepository,SessionReader,Principal} from '../platform/contracts.ts';
import {PlatformError} from '../platform/domain.ts';
import {assertLocalRequest} from '../platform/request-boundary.ts';
import {readWritePermit,type WritePermitBinding} from '../deployment-candidate/write-permit.ts';
import type {PersonalConfig} from './config.ts';
import {PersonalService} from './service.ts';
import {handlePersonalRequest} from './http.ts';
export const personalPermitPath='/run/lifeos-platform/write-gate/permit.json';
/** No password, URL credentials, API secret or owner content participates in this digest. */
export function personalPermitBinding(config:PersonalConfig,sourceSha:string):WritePermitBinding{
 const configDigest=createHash('sha256').update(JSON.stringify({ownerId:config.ownerId,ownerEmail:config.ownerEmail,spaceId:config.spaceId,databaseName:config.databaseName,baseURL:config.baseURL,allowedTypes:config.allowedTypes,...(config.transport?{transport:config.transport}:{}),...(config.readonlyLoginApproved?{readonlyLoginApproved:true}:{}),...(config.calendarEnabled?{calendarEnabled:true}:{}),...(config.mediaEnabled?{mediaEnabled:true}:{}),...(config.cookingEnabled?{cookingEnabled:true}:{}),...(config.careerEnabled?{careerEnabled:true}:{}),...(config.portfolioEnabled?{portfolioEnabled:true}:{}),...(config.healthEnabled?{healthEnabled:true}:{}),...(config.peopleEnabled?{peopleEnabled:true}:{}),...(config.financeEnabled?{financeEnabled:true}:{}),...(config.requirementsEnabled?{requirementsEnabled:true}:{}),...(config.requirementSupportEnabled?{requirementSupportEnabled:true}:{}),...(config.businessWriteMode?{businessWriteMode:config.businessWriteMode}:{})})).digest('hex');
 return{sourceSha,spaceId:config.spaceId,configDigest};
}
export function requirePersonalWritePermit(config:PersonalConfig,sourceSha:string):void{
 if(!readWritePermit(personalPermitPath,personalPermitBinding(config,sourceSha)))throw new PlatformError(503,'PERSONAL_WRITES_LOCKED','本人空间写入许可尚未激活或已失效，请保留原保存请求。');
}
/** Only the approved personal app uses this capability. Import/maintenance tools
 * retain their separate short-lived permit and do not inherit owner CRUD access. */
export function requirePersonalBusinessWrite(config:PersonalConfig,sourceSha:string):void{
 if(config.businessWriteMode==='owner-managed')return;
 if(config.businessWriteMode==='disabled')throw new PlatformError(503,'PERSONAL_WRITES_LOCKED','本人空间业务写入已关闭，请保留原保存请求。');
 requirePersonalWritePermit(config,sourceSha);
}
const respond=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
export function createPersonalPlatformHandler(options:{repository:PlatformRepository;sessions:SessionReader;config:PersonalConfig;storageVerified:boolean;classification?:{authority:AuthorityService;service:ClassificationService};fileHandoff?:{runtime:FileHandoffRuntime;authority:AuthorityService};releaseArtifact?:()=>ReleaseArtifact|null;assertWritable:()=>Promise<void>}):(request:Request)=>Promise<Response>{
 const artifact=options.releaseArtifact??readReleaseArtifact;
 const serviceConfig=options.storageVerified?options.config:{...options.config,mediaEnabled:undefined,careerEnabled:undefined,portfolioEnabled:undefined,cookingEnabled:undefined};
 const service=new PersonalService(options.repository,serviceConfig,{currentSourceSha:()=>artifact()?.sourceSha??null});
 const storageReview=options.storageVerified?new StorageReviewService(options.repository,options.config):undefined;
 return async request=>{
  try{
   const url=new URL(request.url);assertLocalRequest(request,options.config.baseURL);
   const assertOwner=async():Promise<void>=>{
    if(request.signal.aborted)throw new PlatformError(499,'REQUEST_CANCELLED','已取消，尚未确认保存。');
    let principal:Principal|null;try{principal=await options.sessions.read(request.headers);}catch{throw new PlatformError(503,'AUTH_UNAVAILABLE','身份服务暂不可用。');}
    if(!principal)throw new PlatformError(401,'LOGIN_REQUIRED','请先登录。');
    if(principal.userId!==options.config.ownerId||principal.email.toLowerCase()!==options.config.ownerEmail)throw new PlatformError(403,'ACCOUNT_NOT_ALLOWED','此账号没有访问本人空间的权限。');
   };
   if(url.pathname==='/api/platform/personal/availability'){
    if(request.method!=='GET'||url.search)return respond({error:{code:'METHOD_NOT_ALLOWED',message:'此状态仅可读取。'}},405);
    let writable=false;try{await options.assertWritable();writable=true;}catch{}
    return respond({configured:true,writable,loginAllowed:options.config.readonlyLoginApproved===true||writable,https:new URL(options.config.baseURL).protocol==='https:',transport:options.config.transport??'https',origin:options.config.baseURL,userAccepted:false});
   }
   await assertOwner();
   if(url.pathname==='/api/platform/personal/file-handoffs'||url.pathname.startsWith('/api/platform/personal/file-handoffs/')){
    if(!options.fileHandoff)return respond({error:{code:'NOT_FOUND',message:'文件交接尚未开放。'}},404);
    if(request.headers.has('authorization'))throw new PlatformError(403,'OWNER_ONLY','文件网页入口仅限本人会话。');
    const actor=await options.fileHandoff.authority.resolveOwnerActor(request.headers);if(!actor)throw new PlatformError(403,'OWNER_ONLY','需要当前本人 MFA 会话。');
    return(await handleFileHandoffRequest(request,{mount:'/api/platform/personal/file-handoffs',session:options.fileHandoff.runtime.forOwner(actor),current:async(write)=>{
     await assertOwner();await options.fileHandoff!.authority.assertCurrentAuthority(actor,write?'acknowledgeFileHandoff':url.pathname.endsWith('/content')?'downloadFileHandoff':'getFileHandoff');
     if(write){if(request.headers.get('origin')!==options.config.baseURL)throw new PlatformError(403,'ORIGIN_DENIED','文件确认需要相同来源。');await options.assertWritable();}
    }}))!;
   }
   if(url.pathname==='/api/platform/personal/status'||url.pathname==='/api/platform/status'){
    if(request.method!=='GET'||url.search)return respond({error:{code:'METHOD_NOT_ALLOWED',message:'此状态仅可读取。'}},405);
    let writable=false;try{await options.assertWritable();writable=true;}catch{/* Only this capability is unavailable; never leak the permit path or contents. */}
    return respond({scope:'personal-manual-candidate',ownerId:options.config.ownerId,spaceId:options.config.spaceId,allowedTypes:options.config.allowedTypes,requirementsEnabled:options.config.requirementsEnabled===true,calendarEnabled:options.config.calendarEnabled===true,mediaEnabled:options.storageVerified&&options.config.mediaEnabled===true,careerEnabled:options.storageVerified&&options.config.careerEnabled===true,portfolioEnabled:options.storageVerified&&options.config.portfolioEnabled===true,cookingEnabled:options.storageVerified&&options.config.cookingEnabled===true,healthEnabled:options.config.healthEnabled===true,peopleEnabled:options.config.peopleEnabled===true,financeEnabled:options.config.financeEnabled===true,requirementSupportEnabled:options.config.requirementSupportEnabled===true,personalAccountReady:true,personalDataAuthorized:true,storageVerified:options.storageVerified,storageReviewEnabled:options.storageVerified,fileHandoffEnabled:!!options.fileHandoff,writable,aiEnabled:false,userAccepted:false});
   }
   // Personal mode has a narrow independent API. Legacy fixture/AI/import/finance routes stay closed.
   if(!url.pathname.startsWith('/api/platform/personal/'))throw new PlatformError(404,'PERSONAL_ROUTE_ONLY','本人模式仅开放手工待办与日记入口。');
   if(url.pathname==='/api/platform/personal/todo-classifications'||url.pathname.startsWith('/api/platform/personal/todo-classifications/')){
    if(!options.classification)return respond({error:{code:'NOT_FOUND',message:'分类尚未开放。'}},404);
    if(request.headers.has('authorization'))throw new PlatformError(403,'OWNER_ONLY','仅限本人会话。');
    const actor=await options.classification.authority.resolveOwnerActor(request.headers);
    if(!actor)throw new PlatformError(403,'OWNER_ONLY','需要当前本人 MFA 会话。');
    return (await handleOwnerClassificationRequest(request,actor,options.classification.service,{baseURL:options.config.baseURL,assertOwner,assertWritable:options.assertWritable}))!;
   }
   if(url.pathname==='/api/platform/personal/calendar'||url.pathname.startsWith('/api/platform/personal/calendar/')){
    if(request.headers.has('authorization'))throw new PlatformError(403,'OWNER_ONLY','日程网页入口仅限当前本人 MFA 会话。');
    let writable=false;try{await options.assertWritable();writable=true;}catch{}
    const calendar=options.config.calendarEnabled&&options.storageVerified?new PersonalCalendarService(service,{ownerId:options.config.ownerId,spaceId:options.config.spaceId,enabled:true,writable}):undefined;
    const response=await handlePersonalCalendar(request,{ownerId:options.config.ownerId,baseURL:options.config.baseURL,service:calendar,guard:async()=>{if(request.signal.aborted)throw new PlatformError(409,'REQUEST_CANCELLED','请求已取消，保存结果未确认。');await assertOwner();await options.assertWritable();}});
    await assertOwner();return response!;
   }
   if(url.pathname==='/api/platform/personal/finance'||url.pathname.startsWith('/api/platform/personal/finance/')){let writable=false;try{await options.assertWritable();writable=true;}catch{}const finance=options.config.financeEnabled&&options.storageVerified?new PersonalFinanceService(options.repository,{ownerId:options.config.ownerId,spaceId:options.config.spaceId,enabled:true,writable}):undefined;return (await handlePersonalFinance(request,{ownerId:options.config.ownerId,baseURL:options.config.baseURL,service:finance,assertOwner,guard:options.assertWritable}))!;}
   const supportResponse=await handleRequirementSupportRequest(request,options.config.ownerId,service.requirementSupport,{assertOwner,assertWritable:options.assertWritable},artifact);
   if(supportResponse)return supportResponse;
   const storageReviewResponse=await handleStorageReviewRequest(request,{ownerId:options.config.ownerId,baseURL:options.config.baseURL,service:storageReview,assertOwner,assertWritable:options.assertWritable});
   if(storageReviewResponse)return storageReviewResponse;
   const requirementResponse=await handleRequirementsRequest(request,options.config.ownerId,service.requirements,{assertOwner,assertWritable:options.assertWritable});
   if(requirementResponse)return requirementResponse;
   if(/^\/api\/platform\/personal\/(media|career|portfolio|cooking)(?:\/|$)/.test(url.pathname)&&!options.storageVerified)throw new PlatformError(503,'PERSONAL_STORAGE_UNAVAILABLE','本人记录存储尚未核验。');
   const response=await handlePersonalRequest(request,options.config.ownerId,options.config.baseURL,service,{assertOwner,assertWritable:options.assertWritable});
   return response??respond({error:{code:'NOT_FOUND',message:'此本人空间接口未开放。'}},404);
  }catch(error){return error instanceof PlatformError?respond({error:{code:error.code,message:error.message}},error.status):respond({error:{code:'PERSONAL_UNAVAILABLE',message:'本人空间暂不可用，保存结果未确认。'}},503);}
 };
}
