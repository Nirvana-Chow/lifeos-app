import {createHash} from 'node:crypto';
import type {PlatformRepository,SessionReader,Principal} from '../platform/contracts.ts';
import {PlatformError} from '../platform/domain.ts';
import {assertLocalRequest} from '../platform/request-boundary.ts';
import {readWritePermit,type WritePermitBinding} from '../deployment-candidate/write-permit.ts';
import type {PersonalConfig} from './config.ts';
import {PersonalService} from './service.ts';
import {handlePersonalRequest} from './http.ts';
import {createAppleSyncHandler} from '../apple-sync-candidate/http.ts';
export const personalPermitPath='/run/lifeos-platform/write-gate/permit.json';
/** No password, URL credentials, API secret or owner content participates in this digest. */
export function personalPermitBinding(config:PersonalConfig,sourceSha:string):WritePermitBinding{
 const configDigest=createHash('sha256').update(JSON.stringify({ownerId:config.ownerId,ownerEmail:config.ownerEmail,spaceId:config.spaceId,databaseName:config.databaseName,baseURL:config.baseURL,allowedTypes:config.allowedTypes,...(config.transport?{transport:config.transport}:{}),...(config.readonlyLoginApproved?{readonlyLoginApproved:true}:{}),...(config.businessWriteMode?{businessWriteMode:config.businessWriteMode}:{})})).digest('hex');
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
export function createPersonalPlatformHandler(options:{repository:PlatformRepository;sessions:SessionReader;config:PersonalConfig;storageVerified:boolean;assertWritable:()=>Promise<void>;appleSync?:(request:Request)=>Promise<Response>}):(request:Request)=>Promise<Response>{
 const service=new PersonalService(options.repository,options.config);
 const appleSync=options.appleSync??createAppleSyncHandler({baseURL:options.config.baseURL});
 return async request=>{
  try{
   const url=new URL(request.url);assertLocalRequest(request,options.config.baseURL);
   if(url.pathname==='/api/platform/personal/apple-sync'||url.pathname.startsWith('/api/platform/personal/apple-sync/'))return appleSync(request);
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
   if(url.pathname==='/api/platform/personal/status'||url.pathname==='/api/platform/status'){
    if(request.method!=='GET'||url.search)return respond({error:{code:'METHOD_NOT_ALLOWED',message:'此状态仅可读取。'}},405);
    let writable=false;try{await options.assertWritable();writable=true;}catch{/* Only this capability is unavailable; never leak the permit path or contents. */}
    return respond({scope:'personal-manual-candidate',ownerId:options.config.ownerId,spaceId:options.config.spaceId,allowedTypes:options.config.allowedTypes,personalAccountReady:true,personalDataAuthorized:true,storageVerified:options.storageVerified,writable,aiEnabled:false,userAccepted:false});
   }
   // Personal mode has a narrow independent API. Legacy fixture/AI/import/finance routes stay closed.
   if(!url.pathname.startsWith('/api/platform/personal/'))throw new PlatformError(404,'PERSONAL_ROUTE_ONLY','本人模式仅开放手工待办与日记入口。');
   const response=await handlePersonalRequest(request,options.config.ownerId,options.config.baseURL,service,{assertOwner,assertWritable:options.assertWritable});
   return response??respond({error:{code:'NOT_FOUND',message:'此本人空间接口未开放。'}},404);
  }catch(error){return error instanceof PlatformError?respond({error:{code:error.code,message:error.message}},error.status):respond({error:{code:'PERSONAL_UNAVAILABLE',message:'本人空间暂不可用，保存结果未确认。'}},503);}
 };
}
