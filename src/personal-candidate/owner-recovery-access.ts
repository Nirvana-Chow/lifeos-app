import type {BetterAuthOptions} from 'better-auth';
import type {PlatformConfig} from '../platform/config.ts';
import {ownerRecoveryFinishOnly} from './owner-email-reset.ts';
type Capability={enabled:boolean;ownerAlias?:'owner'};
type Options={capability:()=>Promise<Capability>;withOwnerLock:<T>(run:()=>Promise<T>)=>Promise<T>;limit:(action:'request'|'finish')=>Promise<void>};
export function ownerRecoveryUnavailable(){return Response.json({error:{code:'RECOVERY_UNAVAILABLE',message:'本人密码恢复尚未启用。'}},{status:503,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
export function ownerRecoveryAccess(config:PlatformConfig,database:BetterAuthOptions['database'],options:Options){
 const capability=async():Promise<Capability>=>{try{const c=await options.capability();return c.enabled===true&&c.ownerAlias==='owner'?{enabled:true,ownerAlias:'owner'}:c.enabled===true?{enabled:true}:{enabled:false};}catch{return{enabled:false};}};
 const finish=ownerRecoveryFinishOnly(config,database,{enabled:true,limit:options.limit,withOwnerLock:async run=>options.withOwnerLock(async()=>{if(!(await capability()).enabled)throw Error('RECOVERY_UNAVAILABLE');return run();})});
 return{capability,handle:async(request:Request)=>{if(!(await capability()).enabled)return ownerRecoveryUnavailable();return finish(request);}};
}
