import{publicAISettingsSchema,type PublicAISettings}from'../platform/ai-settings-contract.ts';
import{z}from'zod';
export class AISettingsRequestError extends Error{status:number;uncertain:boolean;code:string;constructor(message:string,status:number,uncertain=false,code='REQUEST_FAILED'){super(message);this.status=status;this.uncertain=uncertain;this.code=code;}}
export const isAISettingsIdentityFailure=(cause:unknown)=>cause instanceof AISettingsRequestError&&(cause.status===401||cause.status===403||cause.code==='IDENTITY_UNAVAILABLE');
function interrupted(signal:AbortSignal,uncertain:boolean):AISettingsRequestError{return new AISettingsRequestError(uncertain?'连接测试已停止等待，结果仍需重新读取；可能已发送、产生费用或保存状态。':'连接测试已取消，尚未发送请求。',signal.reason?.name==='TimeoutError'?503:499,uncertain,signal.reason?.name==='TimeoutError'?'AI_CONNECTION_TEST_TIMEOUT':'AI_CONNECTION_TEST_CANCELLED');}
function checkSignal(signal:AbortSignal|undefined,uncertain:boolean){if(signal?.aborted)throw interrupted(signal,uncertain);}
async function waitSignal<T>(work:Promise<T>,signal:AbortSignal|undefined,uncertain:boolean):Promise<T>{
 if(!signal)return work;if(signal.aborted){void work.catch(()=>{});throw interrupted(signal,uncertain);}let abort!:()=>void;
 try{return await Promise.race([work,new Promise<never>((_,reject)=>{abort=()=>reject(interrupted(signal,uncertain));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();})]);}finally{signal.removeEventListener('abort',abort);}
}
const identitySchema=z.object({user:z.object({id:z.string().min(1).max(256)}),session:z.object({userId:z.string().min(1).max(256)})});
// Only exact server rejections known to precede this mutation are definitive.
const prewriteRejections:Record<string,number>={LOGIN_REQUIRED:401,ACCOUNT_NOT_ALLOWED:403,ORIGIN_DENIED:403,METHOD_NOT_ALLOWED:405,JSON_REQUIRED:415,INVALID_JSON:400,BODY_TOO_LARGE:413,INVALID_AI_SETTINGS:400,AI_SETTINGS_UNAVAILABLE:503,AI_SECRET_ENTRY_UNAVAILABLE:503,AI_CALLS_NOT_APPROVED:503,AI_SECRET_REQUIRED:409,AI_TEST_BUSY:409,AI_NOT_READY:409};
const atomicRejections:Record<string,number>={AI_SETTINGS_CONFLICT:409,AI_SETTINGS_VERSION_LIMIT:409,AI_SETTINGS_NOT_FOUND:404};
export class AISettingsClient{
 private transport:typeof fetch;private owner:string|undefined;constructor(transport:typeof fetch=fetch){this.transport=transport;}
 private async identity():Promise<void>{
  try{const signal=AbortSignal.timeout(10000),response=await waitSignal(this.transport('/api/platform/auth/get-session',{credentials:'same-origin',cache:'no-store',signal}),signal,false);
   if(response.status===401)throw new AISettingsRequestError('登录已失效，请恢复原账号。',401,false,'LOGIN_REQUIRED');
   if(response.status===403)throw new AISettingsRequestError('当前账号无权读取此配置，请恢复原账号。',403,false,'ACCOUNT_NOT_ALLOWED');
   if(!response.ok)throw Error('Identity unavailable');const value:unknown=await waitSignal(response.json(),signal,false);if(value===null)throw new AISettingsRequestError('登录已失效，请恢复原账号。',401,false,'LOGIN_REQUIRED');
   const checked=identitySchema.safeParse(value);if(!checked.success||checked.data.user.id!==checked.data.session.userId)throw Error('Invalid identity');
   const owner=checked.data.user.id;if(this.owner!==undefined&&this.owner!==owner)throw new AISettingsRequestError('登录账号已变化，请恢复原账号后重新读取。',403,false,'ACCOUNT_CHANGED');this.owner=owner;
  }catch(cause){if(isAISettingsIdentityFailure(cause))throw cause;throw new AISettingsRequestError('暂时无法核对原账号，已隐藏配置。',0,false,'IDENTITY_UNAVAILABLE');}
 }
 async request(path:string,method='GET',body?:unknown,canDispatch?:()=>boolean,signal?:AbortSignal):Promise<PublicAISettings>{
  checkSignal(signal,false);await waitSignal(this.identity(),signal,false);checkSignal(signal,false);if(canDispatch&&!canDispatch())throw new AISettingsRequestError('页面已隐藏，请重新核对账号后提交。',0,false,'VIEW_HIDDEN');
  let value:PublicAISettings;
  try{value=await aiSettingsRequest(this.transport,path,method,body,signal);}
  catch(cause){if(isAISettingsIdentityFailure(cause))throw cause;try{await this.identity();}catch(identity){const error=identity as AISettingsRequestError;throw new AISettingsRequestError(error.message,error.status,method!=='GET'&&(cause instanceof AISettingsRequestError&&cause.uncertain),error.code);}throw cause;}
  try{await this.identity();}catch(cause){const error=cause as AISettingsRequestError;throw new AISettingsRequestError(error.message,error.status,method!=='GET',error.code);}checkSignal(signal,method!=='GET');if(canDispatch&&!canDispatch())throw new AISettingsRequestError('页面条件已变化，本次结果需重新读取。',0,method!=='GET','VIEW_CHANGED');return value;
 }
}
export async function aiSettingsRequest(fetcher:typeof fetch,path:string,method='GET',body?:unknown,callerSignal?:AbortSignal):Promise<PublicAISettings>{
 const signal=AbortSignal.any([...(callerSignal?[callerSignal]:[]),AbortSignal.timeout(20000)]);checkSignal(signal,false);
 let response:Response;try{response=await waitSignal(fetcher('/api/platform/ai/'+path,{method,credentials:'same-origin',cache:'no-store',signal,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),signal,method!=='GET');}catch(cause){if(cause instanceof AISettingsRequestError)throw cause;throw new AISettingsRequestError(method==='GET'?'配置读取失败。':'本次操作结果未确认，请重新读取；不要自动重复测试连接。',0,method!=='GET');}
 const authMessage=response.status===401?'请先登录评审账号。':response.status===403?'当前账号或请求来源未通过核对，请恢复原账号。':undefined;
 let value;try{value=await waitSignal(response.json(),signal,method!=='GET');}catch(cause){if(authMessage)throw new AISettingsRequestError(authMessage,response.status,method!=='GET');if(cause instanceof AISettingsRequestError)throw cause;throw new AISettingsRequestError('结果未确认，请重新读取。',response.status,method!=='GET');}
 if(!response.ok){const messages:Record<string,string>={AI_TEST_BUSY:'上次测试尚未确认，请稍后重新读取。',AI_SETTINGS_CONFLICT:'配置已变化，请重新读取并核对本次操作。',AI_CALLS_NOT_APPROVED:'外部调用和费用尚未获准。',AI_SECRET_ENTRY_UNAVAILABLE:'安全入口或秘密存储尚未就绪。',INVALID_AI_SETTINGS:'请核对配置字段、版本和确认选项。',AI_CONNECTION_TEST_FAILED:'连接测试未确认成功，请重新读取；重试可能再次计费。',AI_CONNECTION_TEST_CANCELLED:'连接测试已停止等待，请重新读取；可能已发送、产生费用或保存状态。',AI_CONNECTION_TEST_TIMEOUT:'连接测试等待超时，请重新读取；可能已发送、产生费用或保存状态。'};
  const code=typeof value?.error?.code==='string'?value.error.code:'',definitive=!(path==='connection-test'&&['LOGIN_REQUIRED','ACCOUNT_NOT_ALLOWED'].includes(code))&&(prewriteRejections[code]===response.status||(path!=='connection-test'&&atomicRejections[code]===response.status));
  // Connection-test CAS or final owner rejection can follow the paid provider call.
  throw new AISettingsRequestError(authMessage??messages[code]??'本次操作结果未确认，请重新读取；不要自动重复提交。',response.status,method!=='GET'&&!definitive,code||'REQUEST_FAILED');}
 checkSignal(signal,method!=='GET');const checked=publicAISettingsSchema.safeParse(value);if(!checked.success)throw new AISettingsRequestError('配置响应未通过校验，请重新读取。',response.status,method!=='GET');return checked.data;
}
