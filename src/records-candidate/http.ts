import {PlatformError} from '../platform/domain.ts';
import {readJSONBody} from '../platform/request-boundary.ts';
import {validateRecordType} from './domain.ts';
import type {RecordsService} from './service.ts';
import type {ProjectLinkType} from './contracts.ts';

const respond=(value:unknown,status=200,extra:Record<string,string>={})=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie',...extra}});
function projectQuery(request:Request,url:URL,candidates=false){
 const keys=candidates?['type','q','includeSynthetic']:['includeSynthetic'],seen=new Set<string>();
 for(const[key]of url.searchParams){if(!keys.includes(key)||seen.has(key))throw new PlatformError(400,'INVALID_PROJECT_QUERY','项目查询包含未知或重复字段。');seen.add(key);}
 const include=url.searchParams.get('includeSynthetic');
 if(request.body!==null||include!==null&&!['true','false'].includes(include))throw new PlatformError(400,'INVALID_PROJECT_QUERY','请明确选择合成记录读取范围。');
 return{includeSynthetic:include==='true'};
}
/** Mounted after the common host, session and owner gates. */
export async function handleRecords(request:Request,owner:string,baseURL:string,service:RecordsService):Promise<Response|null>{
 const url=new URL(request.url);
 if(/^\/api\/platform\/records\/project-links\/?$/.test(url.pathname)){
  if(request.method!=='GET')return respond({error:{code:'METHOD_NOT_ALLOWED',message:'项目关联候选只支持读取。'}},405,{Allow:'GET'});
  const view=projectQuery(request,url,true);return respond(await service.linkCandidates(owner,url.searchParams.get('type') as ProjectLinkType,url.searchParams.get('q')??'',view));
 }
 const match=/^\/api\/platform\/records\/([^/]+)(?:\/([^/]+))?(?:\/(history|review|recap))?\/?$/.exec(url.pathname);
 if(!match)return null;
 const type=validateRecordType(match[1]),id=match[2]??null,history=match[3]==='history',review=match[3]==='review',recap=match[3]==='recap',view={includeSynthetic:url.searchParams.get('includeSynthetic')==='true'};
 if((review||recap)&&(type!=='project'||!id))throw new PlatformError(404,'NOT_FOUND','没有可访问的项目操作。');
 const allowed=review?['POST']:history||recap?['GET']:id?['GET','PATCH']:['GET','POST'];
 if(!allowed.includes(request.method))return respond({error:{code:'METHOD_NOT_ALLOWED',message:'此记录操作不支持该方法。'}},405,{Allow:allowed.join(', ')});
 if(request.method==='GET'){
  if(recap&&id)return respond(await service.recap(owner,id,projectQuery(request,url)));
  if(history&&id)return respond({history:await service.history(owner,type,id,view),limit:100});
  return respond(id?{entry:await service.get(owner,type,id,view)}:{items:await service.list(owner,type,view),dataStatus:'isolated-test-drafts',syntheticIncluded:view.includeSynthetic});
 }
 if(request.headers.get('origin')!==new URL(baseURL).origin)throw new PlatformError(403,'ORIGIN_DENIED','记录保存需要相同来源。');
 const body=await readJSONBody(request),key=request.headers.get('idempotency-key')??'';
 const result=review?await service.reviewProject(owner,id!,body,key):id?await service.update(owner,type,id,body,key):await service.create(owner,type,body,key);
 return respond(result,!id&&!result.duplicate?201:200);
}
