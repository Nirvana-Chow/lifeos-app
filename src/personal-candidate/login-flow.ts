import {passwordLoginDestination} from './owner-mfa-flow.ts';

type LoginAttempt={personal:boolean;challenge:boolean;email:string;password:string;code:string;backup:boolean};
export type LoginResult=
 |{kind:'redirect';location:'/account/mfa'|'/review/admin'|'/personal'}
 |{kind:'error'|'challenge'|'unknown';challenge:boolean;message:string};
type LoginFetch=(url:string,init:RequestInit)=>Promise<Response>;

/** Only orchestrates native endpoints. Secrets stay in this one call, never in returned state. */
export async function submitLogin(input:LoginAttempt,request:LoginFetch):Promise<LoginResult>{
 let challenge=input.challenge;
 const post=(url:string,body:unknown)=>request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 try{
  if(!challenge){
   const response=await post('/api/platform/auth/sign-in/email',{email:input.email,password:input.password,rememberMe:false});
   if(!response.ok)return{kind:'error',challenge:false,message:response.status===429?'尝试过于频繁，请稍后再试。':'登录未通过，请核对账号和密码。'};
   const destination=passwordLoginDestination(await response.json(),input.personal);
   if(destination!=='challenge')return{kind:'redirect',location:destination};
   challenge=true;
  }
  if(!input.code.trim())return{kind:'challenge',challenge:true,message:'请输入验证器动态码或备用恢复码。'};
  const response=await post('/api/platform/auth/two-factor/'+(input.backup?'verify-backup-code':'verify-totp'),{code:input.code.trim(),trustDevice:false});
  if(response.ok)return{kind:'redirect',location:input.personal&&!input.backup?'/personal':'/account/mfa'};
  return{kind:'challenge',challenge:true,message:response.status===429?'尝试过于频繁，请稍后再试。':'验证未通过，请核对验证码；登录已失效时请重新开始。'};
 }catch{
  return{kind:'unknown',challenge,message:'登录结果未确认，请重新开始登录后确认。'};
 }
}
