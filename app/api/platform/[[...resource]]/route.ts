import {handlePlatformRequest} from '../../../../src/platform/runtime';

export const runtime='nodejs';
export const dynamic='force-dynamic';

async function handle(request:Request):Promise<Response>{
 const response=await handlePlatformRequest(request);
 if(response.status!==503||!response.headers.get('content-type')?.includes('application/json'))return response;
 let body;
 try{body=await response.clone().json();}catch{return response;}
 if(body?.error?.code!=='PLATFORM_UNAVAILABLE')return response;
 const headers=new Headers(response.headers);
 headers.delete('content-length');
 return Response.json({...body,error:{...body.error,message:'服务暂不可用，请稍后重试。'}},{
  status:response.status,statusText:response.statusText,headers,
 });
}
export {handle as GET,handle as POST,handle as PUT,handle as PATCH,handle as DELETE};
