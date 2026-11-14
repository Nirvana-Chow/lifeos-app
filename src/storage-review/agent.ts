import type {AuthorityService} from '../agent-authority/service.ts';
import type {TrustedAgentActor} from '../agent-authority/contracts.ts';
import type {PlatformRepository} from '../platform/contracts.ts';
import type {PersonalConfig} from '../personal-candidate/config.ts';
import {PlatformError,object} from '../platform/domain.ts';
import {readJSONBody} from '../platform/request-boundary.ts';
import {assertAgentGrant} from '../agent-api/grant-fence.ts';
import {StorageReviewService,storageReviewDetail} from './service.ts';
import type {storageReviewOperations} from './operations.ts';

export async function handleStorageReviewAgent(request:Request,options:{operation:typeof storageReviewOperations[number];recordId?:string;actor:TrustedAgentActor;authority:AuthorityService;repository:PlatformRepository;config:PersonalConfig;currentReady:()=>Promise<boolean>;assertWritable:()=>Promise<void>}):Promise<Response>{
 const {operation,actor,authority}=options;
 if(actor.businessDataPolicy!=='all-personal-business-v1')throw new PlatformError(403,'ACCESS_DENIED','当前授权不包含存储审核。');
 const current=async(write=false)=>{
  if(request.signal.aborted)throw new PlatformError(499,'REQUEST_CANCELLED','请保留原请求并回读结果。');
  try{await authority.assertCurrentAuthority(actor,operation.id);}catch{throw new PlatformError(403,'ACCESS_DENIED','授权已变化。');}
  if(!await options.currentReady())throw new PlatformError(503,'AGENT_OPERATION_UNAVAILABLE','审核操作尚未就绪。');
  if(write)await options.assertWritable();
 };
 const respond=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store',Vary:'Authorization','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow, noarchive'}});
 const service=new StorageReviewService(options.repository,options.config);
 if(operation.method==='GET'){
  await current();const entry=await service.getEntry(actor.ownerId,options.recordId);await current();
  if(operation.id==='getStorageReview'&&!entry)throw new PlatformError(404,'NOT_FOUND','没有可访问的审核记录。');
  return respond(operation.id==='snapshotStorageReviews'?{items:entry?[entry]:[],total:entry?1:0,truncated:false,scope:'full-current-storage-review-snapshot'}:{entry});
 }
 const updating=operation.method==='PATCH',input=object(await readJSONBody(request),updating?['fields','expectedRevision']:['fields']);
 if(updating){await current();const entry=await service.getEntry(actor.ownerId,options.recordId);if(!entry)throw new PlatformError(404,'NOT_FOUND','没有可访问的审核记录。');}
 const fields=object(input.fields,operation.id==='updateStorageReviewNote'?['checklistRevision','itemId','note']:operation.id==='updateStorageReviewDecision'?['checklistRevision','itemId','decision']:['checklist']);
 const guard=()=>current(true),fence=(tx:Parameters<typeof assertAgentGrant>[0])=>assertAgentGrant(tx,actor,operation.requiredScopes,operation.id);
 const audit={kind:'agent-grant' as const,grantId:actor.grantId,operationId:operation.id},key=request.headers.get('idempotency-key')??'';
 const result=operation.id==='updateStorageReviewNote'
  ?await service.saveNoteResult(actor.ownerId,{expectedRevision:input.expectedRevision,checklistRevision:fields.checklistRevision,id:fields.itemId,note:fields.note},key,guard,fence,audit)
  :operation.id==='updateStorageReviewDecision'
  ?await service.saveDecisionResult(actor.ownerId,{expectedRevision:input.expectedRevision,checklistRevision:fields.checklistRevision,id:fields.itemId,decision:fields.decision},key,guard,fence,audit)
  :await service.saveChecklistResult(actor.ownerId,{expectedRevision:updating?input.expectedRevision:null,checklist:fields.checklist},key,guard,fence,audit);
 return respond({entry:storageReviewDetail(result.entry),duplicate:result.duplicate},!updating&&!result.duplicate?201:200);
}
