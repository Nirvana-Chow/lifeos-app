import {PlatformError,validateId} from '../platform/domain.ts';
import {assertLocalRequest,readJSONBody} from '../platform/request-boundary.ts';
import type {PersonalHTTPGuards} from '../personal-candidate/http.ts';
import type {RequirementSupportService} from './service.ts';
import {releaseNotes,type ReleaseArtifact} from '../release-notes-candidate/runtime.ts';
const respond=(v:unknown,status=200,extra:Record<string,string>={})=>Response.json(v,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie','X-Content-Type-Options':'nosniff',...extra}});
export async function handleRequirementSupportRequest(request:Request,owner:string,service:RequirementSupportService,guards:PersonalHTTPGuards,artifact:()=>ReleaseArtifact|null):Promise<Response|null>{
 const url=new URL(request.url),base='/api/platform/personal/requirement-support',path=url.pathname;
 if(path!==base&&!path.startsWith(base+'/'))return null;
 assertLocalRequest(request,service.config.baseURL);
 if(request.headers.has('authorization'))throw new PlatformError(403,'OWNER_ONLY','反馈和更新入口仅限当前本人 MFA 会话。');
 const guard=async(write=false)=>{if(request.signal.aborted)throw new PlatformError(409,'REQUEST_CANCELLED','已取消，请先回读保存结果。');await guards.assertOwner();if(write)await guards.assertWritable();if(request.signal.aborted)throw new PlatformError(409,'REQUEST_CANCELLED','已取消，请先回读保存结果。');};
 await guard();const suffix=path.slice(base.length),release=suffix==='/releases',read=suffix==='/releases/read',readVersion=/^\/releases\/read\/([a-f0-9]{40})$/.exec(suffix),feedback=/^\/feedback(?:\/(snapshot|[a-f0-9-]+))?(?:\/(history))?$/.exec(suffix),reverse=/^\/requirements\/([^/]+)\/feedback$/.exec(suffix);
 if(!release&&service.config.requirementSupportEnabled!==true)throw new PlatformError(404,'REQUIREMENT_SUPPORT_DISABLED','反馈与版本偏好持久化尚未开放。');
 if(!release&&!read&&!readVersion&&!feedback&&!reverse)throw new PlatformError(404,'NOT_FOUND','此需求支持入口未开放。');
 const snapshot=feedback?.[1]==='snapshot',id=feedback?.[1]&&!snapshot?validateId(feedback[1]):null,history=!!feedback?.[2];
 const allowed=release||readVersion||snapshot||history||reverse?['GET']:read?['POST']:id?['GET','PATCH']:['POST'];
 if(!allowed.includes(request.method))return respond({error:{code:'METHOD_NOT_ALLOWED',message:'此入口不支持该方法。'}},405,{Allow:allowed.join(', ')});
 if(history){if(!id)throw new PlatformError(404,'NOT_FOUND','无此反馈历史。');if([...url.searchParams.keys()].some(k=>k!=='limit')||url.searchParams.getAll('limit').length>1)throw new PlatformError(400,'INVALID_QUERY','读取参数无效。');const raw=url.searchParams.get('limit'),limit=raw===null?50:/^[1-9]\d{0,2}$/.test(raw)?Number(raw):NaN;const result=await service.history(owner,id,limit);await guard();return respond(result);}
 if(url.search)throw new PlatformError(400,'INVALID_QUERY','此入口不支持额外查询参数。');
 if(request.method==='GET'){
  let result:unknown;
  if(release){const current=artifact();result={...releaseNotes(current),preferencesEnabled:service.config.requirementSupportEnabled===true,readState:current&&service.config.requirementSupportEnabled===true?await service.releaseRead(owner,current.sourceSha):null};}
  else result=readVersion?{entry:await service.releaseRead(owner,readVersion[1])}:reverse?await service.forRequirement(owner,decodeURIComponent(reverse[1])):snapshot?await service.snapshot(owner):{entry:await service.feedback(owner,id!)};
  await guard();return respond(result);
 }
 if(request.headers.get('origin')!==new URL(service.config.baseURL).origin)throw new PlatformError(403,'ORIGIN_DENIED','保存需要相同来源。');
 const input=await readJSONBody(request),key=request.headers.get('idempotency-key')??'';await guard(true);
 const result=read?await service.markReleaseRead(owner,input,key,()=>guard(true)):id?await service.reviewFeedback(owner,id,input,key,()=>guard(true)):await service.createFeedback(owner,input,key,()=>guard(true));
 return respond(result,!read&&!id&&!result.duplicate?201:200);
}
