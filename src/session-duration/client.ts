import {storedSessionDuration} from './policy.ts';
export type DeviceSessionStatus={kind:'active';expiresAt:number}|{kind:'locked'};
export async function checkDeviceSession(request:typeof fetch,signal?:AbortSignal):Promise<DeviceSessionStatus>{
 try{
  const read=async(method:'GET'|'POST')=>{signal?.throwIfAborted();const response=await request('/api/platform/auth/get-session',{method,cache:'no-store',credentials:'same-origin',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000),...(method==='POST'?{headers:{'content-type':'application/json'},body:'{}'}:{})});if(!response.ok)throw Error('SESSION_UNVERIFIED');const value=await response.json();if(!value?.session||value.session.mfaVerified!==true)throw Error('SESSION_UNVERIFIED');const policy=storedSessionDuration(value.session),expiresAt=new Date(value.session.expiresAt).valueOf();if(!Number.isFinite(expiresAt)||expiresAt<=Date.now())throw Error('SESSION_EXPIRED');return{value,policy,expiresAt};};
  let current=await read('GET');signal?.throwIfAborted();if(current.value.needsRefresh===true&&current.policy.mode==='rolling')current=await read('POST');
  signal?.throwIfAborted();return{kind:'active',expiresAt:current.expiresAt};
 }catch{return{kind:'locked'};}
}
export function safeSessionReturn(value:unknown):string{
 if(typeof value!=='string'||value.length>2048||!/^\/personal(?:[/?]|$)/.test(value)||/[\\#\u0000-\u0020]/.test(value))return'/personal';
 try{const url=new URL(value,'https://session.invalid');if(url.origin!=='https://session.invalid'||url.pathname!=='/personal'&&!url.pathname.startsWith('/personal/')||url.pathname+url.search!==value)return'/personal';return value;}catch{return'/personal';}
}
