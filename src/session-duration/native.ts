import type {BetterAuthPlugin} from 'better-auth';
import {APIError,createAuthMiddleware} from 'better-auth/api';
import {parseSessionDuration,storedSessionDuration,type StoredSessionDuration} from './policy.ts';
export const sessionDurationPluginId='lifeos-session-duration';
type PolicyContext={lifeosSessionDuration?:StoredSessionDuration};
export function creationSessionDuration(context:unknown):StoredSessionDuration{
 const policy=(context as PolicyContext|undefined)?.lifeosSessionDuration;
 if(!policy)throw Error('SESSION_DURATION_CONTEXT_REQUIRED');
 return policy;
}
/** Each endpoint receives its own context copy; never mutate the shared auth options. */
export function sessionDurationPlugin(readOnly=false):BetterAuthPlugin{
 return{id:sessionDurationPluginId,hooks:{before:[{matcher:()=>true,handler:createAuthMiddleware(async ctx=>{
  let policy:StoredSessionDuration;
  try{
   const selecting=ctx.path==='/sign-in/email'||ctx.path==='/two-factor/verify-totp'||ctx.path==='/two-factor/verify-backup-code';
   if(ctx.path==='/sign-in/email'||selecting&&ctx.body?.sessionDuration!==undefined)policy=parseSessionDuration(ctx.body.sessionDuration);
   else{
    const token=await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name,ctx.context.secret);
    const current=token?await ctx.context.internalAdapter.findSession(token):null;
    policy=current?storedSessionDuration(current.session as unknown as Record<string,unknown>):parseSessionDuration(undefined);
   }
  }catch{throw new APIError('BAD_REQUEST',{code:'INVALID_SESSION_DURATION',message:'登录时长无效，请重新选择。'});}
  return{context:{...(ctx.path==='/sign-in/email'?{body:{...ctx.body,rememberMe:true}}:{}),context:{
   lifeosSessionDuration:policy,
   sessionConfig:{...ctx.context.sessionConfig,expiresIn:policy.seconds,updateAge:policy.mode==='rolling'?86400:300},
   options:{...ctx.context.options,session:{...ctx.context.options.session,deferSessionRefresh:true,disableSessionRefresh:readOnly||policy.mode!=='rolling'}},
  }}};
 })}],after:[{matcher:ctx=>readOnly&&ctx.path==='/get-session'&&ctx.method==='GET',handler:createAuthMiddleware(async ctx=>{
  const value=ctx.context.returned as {session?:Record<string,unknown>;needsRefresh?:boolean}|null;
  if(!value?.session)return;
  const policy=storedSessionDuration(value.session),expires=new Date(value.session.expiresAt as string).valueOf();
  // This is a read-only hint. The writable native POST independently rechecks policy and expiry.
  if(policy.mode==='rolling'&&expires>Date.now()&&expires-policy.seconds*1000+86400000<=Date.now())return ctx.json({...value,needsRefresh:true});
 })}]}};
}
