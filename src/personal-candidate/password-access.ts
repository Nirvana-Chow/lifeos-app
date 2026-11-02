import{assertLocalRequest,readJSONBody}from'../platform/request-boundary.ts';
/** Inert until separately approved server wiring supplies real owner/proof readers. */
export function passwordAccess(options:{enabled:boolean;allowReset?:boolean;signOutAfterChange?:boolean;baseURL:string;ownerId:string;readOwner:(headers:Headers)=>Promise<string|null>;readResetOwner:(token:string)=>Promise<string|null>;handler:(request:Request)=>Promise<Response>}){
 return async(request:Request)=>{const reply=(status:number,message:string)=>Response.json({message},{status,headers:{'Cache-Control':'private, no-store'}});try{
  if(!options.enabled)return reply(503,'本人密码设置尚未启用。');const url=new URL(request.url);if(request.method!=='POST'||url.search)return reply(400,'请求无效。');assertLocalRequest(request,options.baseURL);if(request.headers.get('origin')!==options.baseURL)return reply(403,'来源不符。');
  const body=await readJSONBody(request) as Record<string,unknown>;if(!body||Array.isArray(body))return reply(400,'请求无效。');const mode=body.mode,password=body.newPassword;if(mode==='reset'&&options.allowReset===false)return reply(404,'此身份操作未开放。');if(typeof password!=='string'||password.length<12||password.length>128)return reply(400,'密码需要12至128个字符。');
  let path:string,payload:Record<string,unknown>;
  if(mode==='change'){if(Object.keys(body).some(k=>!['mode','newPassword','currentPassword'].includes(k))||typeof body.currentPassword!=='string')return reply(400,'请求无效。');if(await options.readOwner(request.headers)!==options.ownerId)return reply(401,'请先登录本人账号。');path='change-password';payload={currentPassword:body.currentPassword,newPassword:password,revokeOtherSessions:true};}
  else if(mode==='reset'){if(Object.keys(body).some(k=>!['mode','newPassword','token'].includes(k))||typeof body.token!=='string'||!/^[-_A-Za-z0-9]{32,256}$/.test(body.token))return reply(400,'授权码无效。');if(await options.readResetOwner(body.token)!==options.ownerId)return reply(403,'授权码无效或已失效。');path='reset-password';payload={token:body.token,newPassword:password};}
  else return reply(400,'请求无效。');
  // Native Better Auth verifies current password or atomically consumes its own reset verification.
  // No signup/set-password endpoint, alternate user ID or arbitrary backend URL is accepted.
  const headers=new Headers(request.headers);headers.set('x-platform-client','127.0.0.1');headers.delete('content-length');
  const result=await options.handler(new Request(options.baseURL+'/api/platform/auth/'+path,{method:'POST',headers,body:JSON.stringify(payload)}));
  if(result.ok&&mode==='change'&&options.signOutAfterChange){const replacement=result.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');if(!replacement)return reply(503,'改密结果未确认，请重新登录核对。');const logoutHeaders=new Headers(headers);logoutHeaders.set('cookie',replacement);const logout=await options.handler(new Request(options.baseURL+'/api/platform/auth/sign-out',{method:'POST',headers:logoutHeaders,body:'{}'}));if(!logout.ok)return reply(503,'密码可能已更新，但退出未获确认，请重新核对。');const response=reply(200,'密码已更新并退出，请重新登录。');for(const value of logout.headers.getSetCookie())response.headers.append('set-cookie',value);return response;}
  // Do not expose Better Auth's session token or user object in response bodies.
  const response=reply(result.ok?200:400,result.ok?'密码已更新，请重新登录。':'未能更新密码，请核对身份或授权码。');for(const cookie of result.headers.getSetCookie())response.headers.append('set-cookie',cookie);return response;
 }catch{return reply(503,'密码设置结果未确认，请重新核对。');}};
}
