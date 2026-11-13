import type {CredentialProvider} from '../mcp-candidate/config.ts';
import {ackFileSchema,fileIdSchema,commandKey,sha256,fail} from './contracts.ts';
const origin='https://lifeos.nirvanachow.com',mount='/api/platform/agent';
/** Trusted-host composition only: inject its existing secure-store closure, never a tool/config secret. */
export function createFileNativeTransport(options:{credentialProvider:CredentialProvider;credentialFingerprint:string},fetcher:typeof fetch=fetch){
 if(typeof options.credentialProvider!=='function'||!/^[a-f0-9]{64}$/.test(options.credentialFingerprint))fail(403,'FILE_NATIVE_ADOPTION_REQUIRED');
 const provider=options.credentialProvider,fingerprint=options.credentialFingerprint;
 async function request(path:string,method:string,encoded?:string,key?:string,binary=false){
  const match=/^\/v1\/file-handoffs\/([a-f0-9-]{36})(?:\/(content|acknowledgments))?$/.exec(path);
  if(!(method==='GET'&&path==='/v2/capabilities'&&!binary||match&&fileIdSchema.safeParse(match[1]).success&&(method==='GET'&&(binary?match[2]==='content':!match[2])||!binary&&method==='POST'&&match[2]==='acknowledgments')))fail(403,'FILE_NATIVE_PATH_DENIED');
  if(method==='POST'){
   commandKey(key??'');let value:unknown;try{value=JSON.parse(encoded??'');}catch{fail(400,'FILE_ACK_INVALID');}
   if(!ackFileSchema.omit({id:true}).safeParse(value).success)fail(400,'FILE_ACK_INVALID');
  }else if(encoded!==undefined||key!==undefined)fail(400,'FILE_NATIVE_REQUEST_INVALID');
  let secret:unknown;try{secret=await provider();}catch{fail(403,'FILE_CREDENTIAL_UNAVAILABLE');}
  if(typeof secret!=='string'||!/^[-A-Za-z0-9_]{1,256}$/.test(secret)||sha256(secret)!==fingerprint)fail(403,'FILE_CREDENTIAL_BINDING_CHANGED');
  let response:Response;try{response=await fetcher(origin+mount+path,{method,redirect:'manual',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(30000),headers:{authorization:'Bearer '+secret,accept:binary?'application/octet-stream':'application/json',...(encoded===undefined?{}:{'content-type':'application/json'}),...(key?{'idempotency-key':key}:{})},body:encoded});}catch{fail(503,'FILE_NATIVE_TRANSPORT_UNAVAILABLE');}
  if(response.redirected||response.status>=300&&response.status<400||response.url&&response.url!==origin+mount+path){await response.body?.cancel().catch(()=>{});fail(502,'FILE_NATIVE_REDIRECT_DENIED');}
  return{response,secret};
 }
 return{
  nativeBinaryRequest:async(path:string)=>{const result=await request(path,'GET',undefined,undefined,true);return{response:result.response,credentialFingerprint:fingerprint};},
  nativeRequest:async(path:string,method:string,encoded?:string,key?:string)=>{
   const{response,secret}=await request(path,method,encoded,key),reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{if(reader)for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1024*1024)throw Error();chunks.push(part.value);}}
   catch{await reader?.cancel().catch(()=>{});fail(502,'FILE_NATIVE_RESPONSE_INVALID');}finally{reader?.releaseLock();}
   try{const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));if(!value||typeof value!=='object'||Array.isArray(value)||JSON.stringify(value).includes(secret))throw Error();return{status:response.status,data:value as Record<string,unknown>,credentialFingerprint:fingerprint};}
   catch{fail(502,'FILE_NATIVE_RESPONSE_INVALID');}
  },
 };
}
