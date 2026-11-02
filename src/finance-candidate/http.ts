import type {DraftService} from '../platform/service.ts';
import {PlatformError} from '../platform/domain.ts';
import {FinanceComparisonService} from './service.ts';
import {parseFinanceComparisonQuery} from './domain.ts';
const respond=(value:unknown,status=200,extra:Record<string,string>={})=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie',...extra}});
function stopped(signal:AbortSignal){return new PlatformError(signal.reason?.name==='TimeoutError'?503:499,signal.reason?.name==='TimeoutError'?'FINANCE_COMPARISON_TIMEOUT':'FINANCE_COMPARISON_CANCELLED','财务比较已停止等待，没有返回统计；请重新读取。');}
function check(signal:AbortSignal){if(signal.aborted)throw stopped(signal);}
async function wait<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{if(signal.aborted){void work.catch(()=>{});throw stopped(signal);}let abort=()=>{};try{return await Promise.race([work,new Promise<never>((_,reject)=>{abort=()=>reject(stopped(signal));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();})]);}finally{signal.removeEventListener('abort',abort);}}
/** Caller supplies the shared host/session/owner gate and its final owner recheck. */
export async function handleFinanceComparisonRequest(drafts:DraftService,owner:string,request:Request,context:{assertOwner?:(signal:AbortSignal)=>Promise<void>;signal?:AbortSignal}={},now:()=>Date=()=>new Date()):Promise<Response|null>{
 const url=new URL(request.url);if(!/^\/api\/platform\/finance\/compare\/?$/.test(url.pathname))return null;
 if(request.method!=='GET')return respond({error:{code:'METHOD_NOT_ALLOWED',message:'财务比较只支持读取。'}},405,{Allow:'GET'});
 try{
  if(request.body!==null)throw new PlatformError(400,'INVALID_FINANCE_COMPARISON_QUERY','财务比较读取不能携带正文。');const query=parseFinanceComparisonQuery(url.searchParams),signal=AbortSignal.any([request.signal,...(context.signal?[context.signal]:[]),AbortSignal.timeout(15000)]);check(signal);
  const value=await wait(new FinanceComparisonService(drafts,now).compare(owner,query),signal);check(signal);if(context.assertOwner)await wait(context.assertOwner(signal),signal);check(signal);return respond(value);
 }catch(cause){
  if(cause instanceof PlatformError&&[401,403,503].includes(cause.status)&&['LOGIN_REQUIRED','ACCOUNT_NOT_ALLOWED','AUTH_UNAVAILABLE','ACCOUNT_CHANGED'].includes(cause.code))return respond({error:{code:cause.code,message:'暂时无法核对原账号，未返回财务统计。'}},cause.status);
  const known=cause instanceof PlatformError&&['INVALID_FINANCE_COMPARISON_QUERY','FINANCE_COMPARISON_CANCELLED','FINANCE_COMPARISON_TIMEOUT'].includes(cause.code),status=known?cause.status:503,code=known?cause.code:'FINANCE_COMPARISON_UNAVAILABLE';return respond({error:{code,message:status===400?'请核对两个日期区间、隔离范围与来源条数。':status===499?'已取消财务比较，没有返回统计。':'财务统计暂时无法核对，请重新读取。'}},status);
 }
}
