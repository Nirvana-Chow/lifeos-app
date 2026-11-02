import {assertReadableEntries} from '../platform/data-compatibility.ts';
import {PlatformError,object} from '../platform/domain.ts';
import {readJSONBody} from '../platform/request-boundary.ts';
import type {DraftService} from '../platform/service.ts';
import {previewImport} from './preview.ts';
/** Invoked only after the shared request/session/owner boundary. Never invokes a write method. */
export async function handleImportPreview(request:Request,owner:string,baseURL:string,service:DraftService):Promise<Response|null>{
 if(new URL(request.url).pathname!=='/api/platform/import/preview')return null;
 const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',Vary:'Cookie'};
 if(request.method!=='POST')return Response.json({error:{code:'METHOD_NOT_ALLOWED',message:'预览需要显式提交测试文件。'}},{status:405,headers:{...headers,Allow:'POST'}});
 if(request.headers.get('origin')!==new URL(baseURL).origin)throw new PlatformError(403,'ORIGIN_DENIED','预览需要相同来源。');
 const body=object(await readJSONBody(request),['document','syntheticOnly']);
 if(body.syntheticOnly!==true)throw new PlatformError(400,'SYNTHETIC_ONLY','本版只允许明确的虚构测试导出预览。');
 const snapshot=await service.exportSnapshot(owner);assertReadableEntries([...snapshot.entries,...snapshot.history]);
 return Response.json({preview:previewImport(body.document,snapshot.entries)},{headers});
}
