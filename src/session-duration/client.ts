import {storedSessionDuration} from './policy.ts';
type UnverifiedSession = {kind:'locked'} | {kind:'unavailable'};
export type DeviceSessionStatus = {kind:'active';expiresAt:number} | UnverifiedSession;

export async function checkOwnerPageAccess(request:typeof fetch,signal?:AbortSignal):Promise<'active'|'locked'|'unavailable'>{
 try{
  const timeout=AbortSignal.timeout(8000);
  const response=await request('/api/platform/status',{cache:'no-store',credentials:'same-origin',redirect:'manual',signal:signal?AbortSignal.any([signal,timeout]):timeout});
  if(response.status===401||response.status===403)return 'locked';
  return response.ok&&!response.redirected&&response.headers.get('content-type')?.includes('application/json')?'active':'unavailable';
 }catch{return 'unavailable';}
}

export async function checkDeviceSession(request:typeof fetch,signal?:AbortSignal):Promise<DeviceSessionStatus>{
 async function read(method:'GET'|'POST'):Promise<UnverifiedSession|{kind:'active';expiresAt:number;renew:boolean}>{
  signal?.throwIfAborted();
  const timeout=AbortSignal.timeout(8000);
  const response=await request('/api/platform/auth/get-session',{
   method,cache:'no-store',credentials:'same-origin',redirect:'manual',signal:signal?AbortSignal.any([signal,timeout]):timeout,
   ...(method==='POST'?{headers:{'content-type':'application/json'},body:'{}'}:{}),
  });
  if(response.status===401||(method==='GET'&&response.status===403))return{kind:'locked'};
  if(!response.ok)return{kind:'unavailable'};
  const value=await response.json();
  if(value===null||value?.session===null||value?.session?.mfaVerified===false)return{kind:'locked'};
  if(value?.session?.mfaVerified!==true)return{kind:'unavailable'};
  const policy=storedSessionDuration(value.session),expiresAt=new Date(value.session.expiresAt).valueOf();
  if(!Number.isFinite(expiresAt))return{kind:'unavailable'};
  if(expiresAt<=Date.now())return{kind:'locked'};
  return{kind:'active',expiresAt,renew:value.needsRefresh===true&&policy.mode==='rolling'};
 }
 try{
  const session=await read('GET');
  const current=session.kind==='active'&&session.renew?await read('POST'):session;
  signal?.throwIfAborted();
  return current.kind==='active'?{kind:'active',expiresAt:current.expiresAt}:current;
 }catch{return{kind:'unavailable'};}
}
export function safeSessionReturn(value:unknown):string{
 if(typeof value!=='string'||value.length>2048||!/^\/personal(?:[/?]|$)/.test(value)||/[\\#\u0000-\u0020]/.test(value))return'/personal';
 try{const url=new URL(value,'https://session.invalid');if(url.origin!=='https://session.invalid'||url.pathname!=='/personal'&&!url.pathname.startsWith('/personal/')||url.pathname+url.search!==value)return'/personal';return value;}catch{return'/personal';}
}

export function personalLoginHref(path:string,search:Record<string,string|string[]|undefined>){
 const query=new URLSearchParams();
 for(const [name,value] of Object.entries(search)){
  for(const item of Array.isArray(value)?value:value===undefined?[]:[value])query.append(name,item);
 }
 const destination=safeSessionReturn(path+(query.size?'?'+query:''));
 return destination==='/personal'?'/login':'/login?return_to='+encodeURIComponent(destination);
}
