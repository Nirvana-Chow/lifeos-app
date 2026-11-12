import {DiscoverResultSchema,CallToolResultSchema} from '@modelcontextprotocol/core';
import type {z} from 'zod';
import {isObject,validateHostCall} from './contracts.ts';

type CallToolResult=z.infer<typeof CallToolResultSchema>;
export type BrokerPort={
 beforeUse(signal?:AbortSignal):Promise<void>;
 fingerprint(signal?:AbortSignal):Promise<string>;
 request(envelope:{path:'/api/platform/mcp';method:'POST';encoded:string;expectedCredentialFingerprint:string},signal?:AbortSignal):Promise<unknown>;
};
export type DiscoveryInput={}|{view:'index'}|{operationId:string};
const protocol='2026-07-28',requestLimit=131072,responseLimit=8*1024*1024;
const meta={'io.modelcontextprotocol/protocolVersion':protocol,'io.modelcontextprotocol/clientInfo':{name:'lifeos-server-durable-host',version:'1'},'io.modelcontextprotocol/clientCapabilities':{}};
const fingerprintPattern=/^[a-f0-9]{64}$/;
class ChannelError extends Error{
 readonly status:number;readonly outcome='unknown';readonly automaticRetry=false;
 constructor(code:string,status=0){super(code);this.status=status;}
}
const reject=(code:string,status=0):never=>{throw new ChannelError(code,status);};
function discoverInput(input:unknown):DiscoveryInput{
 if(!isObject(input))return reject('INVALID_ARGUMENTS',400);
 const keys=Object.keys(input);
 if(keys.length===0||keys.length===1&&keys[0]==='view'&&input.view==='index'||keys.length===1&&keys[0]==='operationId'&&typeof input.operationId==='string'&&input.operationId.length>0&&input.operationId.length<=100)return input;
 return reject('INVALID_ARGUMENTS',400);
}
async function bounded<T>(signal:AbortSignal,run:()=>Promise<T>):Promise<T>{
 signal.throwIfAborted();
 let cancel:()=>void=()=>{};
 const aborted=new Promise<never>((_resolve,reject)=>{cancel=()=>reject(Error('REQUEST_CANCELLED'));signal.addEventListener('abort',cancel,{once:true});});
 try{return await Promise.race([run(),aborted]);}finally{signal.removeEventListener('abort',cancel);}
}
function envelope(id:number,method:string,args:Record<string,unknown>){return{jsonrpc:'2.0',id,method,params:{...args,_meta:meta}};}
/** Only protocol data and an injected fixed broker port; no credential/HTTP/process facility. */
export function createMcpChannel(port:BrokerPort){
 let sequence=0,binding:string|undefined,prepared=false;
 function encode(method:string,args:Record<string,unknown>){
  const encoded=JSON.stringify(envelope(++sequence,method,args));
  if(Buffer.byteLength(encoded)>requestLimit)reject('REMOTE_REQUEST_TOO_LARGE',400);
  return encoded;
 }
 function decode(encoded:string){
  if(typeof encoded!=='string'||Buffer.byteLength(encoded)>requestLimit)reject('REMOTE_REQUEST_TOO_LARGE',400);
  let rpc:unknown;try{rpc=JSON.parse(encoded);}catch{return reject('REMOTE_ENVELOPE_REJECTED',400);}
  if(!isObject(rpc)||!Number.isSafeInteger(rpc.id)||(rpc.id as number)<1||!isObject(rpc.params))return reject('REMOTE_ENVELOPE_REJECTED',400);
  const{id,method,params}=rpc;
  let args:Record<string,unknown>;
  if(method==='server/discover')args={};
  else if(method==='tools/call'&&params.name==='lifeos_discover')args={name:'lifeos_discover',arguments:discoverInput(params.arguments)};
  else if(method==='tools/call'&&params.name==='lifeos_call'&&isObject(params.arguments)&&Object.keys(params.arguments).sort().join(',')==='arguments,operationId'&&typeof params.arguments.operationId==='string'){
   const validated=validateHostCall(params.arguments.operationId,params.arguments.arguments);
   args={name:'lifeos_call',arguments:{operationId:params.arguments.operationId,arguments:JSON.parse(validated.argsJSON)}};
  }else return reject('REMOTE_ENVELOPE_REJECTED',400);
  if(encoded!==JSON.stringify(envelope(id as number,method as string,args)))return reject('REMOTE_ENVELOPE_REJECTED',400);
  return{id:id as number,method:method as 'server/discover'|'tools/call'};
 }
 async function sendPrepared(encoded:string,expectedFingerprint:string,signal?:AbortSignal):Promise<CallToolResult>{
  const rpc=decode(encoded);
  if(!fingerprintPattern.test(expectedFingerprint)||binding!==expectedFingerprint)reject('CREDENTIAL_BINDING_CHANGED',403);
  if(rpc.method!=='server/discover'&&!prepared)reject('REMOTE_STARTUP_NOT_QUALIFIED');
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000);
  try{
   combined.throwIfAborted();await bounded(combined,()=>port.beforeUse(combined));combined.throwIfAborted();
   const current=await bounded(combined,()=>port.fingerprint(combined));combined.throwIfAborted();
   if(current!==expectedFingerprint)reject('CREDENTIAL_BINDING_CHANGED',403);
   const out=await bounded(combined,()=>port.request({path:'/api/platform/mcp',method:'POST',encoded,expectedCredentialFingerprint:expectedFingerprint},combined));
   combined.throwIfAborted();
   if(!isObject(out)||Object.keys(out).sort().join(',')!=='credentialFingerprint,data,status')return reject('BROKER_RESPONSE_BINDING_REJECTED');
   if(out.credentialFingerprint!==expectedFingerprint)reject('CREDENTIAL_BINDING_CHANGED',403);
   if(out.status!==200)reject(out.status===401?'AUTH_REQUIRED':out.status===403?'ACCESS_DENIED':'REMOTE_TRANSPORT_UNCONFIRMED',typeof out.status==='number'?out.status:0);
   if(Buffer.byteLength(JSON.stringify(out))>responseLimit)reject('REMOTE_RESPONSE_TOO_LARGE');
   const response=out.data;
   if(!isObject(response)||Object.keys(response).sort().join(',')!=='id,jsonrpc,result'||response.jsonrpc!=='2.0'||response.id!==rpc.id||!isObject(response.result)||response.result.resultType!=='complete')return reject('REMOTE_JSONRPC_REJECTED');
   const parsed=(rpc.method==='server/discover'?DiscoverResultSchema:CallToolResultSchema).safeParse(response.result);
   if(!parsed.success)reject('REMOTE_MCP_RESULT_INVALID');
   // Return original validated data: durable callers retain the exact business result.
   return response.result as CallToolResult;
  }catch(error){if(error instanceof ChannelError)throw error;return reject('REMOTE_TRANSPORT_UNCONFIRMED');}
 }
 return{
  get credentialFingerprint(){return binding;},
  async ready(signal?:AbortSignal){
   prepared=false;
   // Bootstrap binds the fingerprint before its first envelope, with the same pre-use guard.
   const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000);
   try{combined.throwIfAborted();await bounded(combined,()=>port.beforeUse(combined));combined.throwIfAborted();const value=await bounded(combined,()=>port.fingerprint(combined));combined.throwIfAborted();
    if(!fingerprintPattern.test(value)||binding!==undefined&&binding!==value)reject('CREDENTIAL_BINDING_CHANGED',403);binding=value;
   }catch(error){if(error instanceof ChannelError)throw error;return reject('REMOTE_TRANSPORT_UNCONFIRMED');}
   const result=await sendPrepared(encode('server/discover',{}),binding!,signal);
   if(!Array.isArray(result.supportedVersions)||!result.supportedVersions.includes(protocol)||!isObject(result.capabilities)||!isObject(result.capabilities.tools))reject('REMOTE_PROTOCOL_UNAVAILABLE');prepared=true;
  },
  prepareCall(operationId:string,input:unknown){const validated=validateHostCall(operationId,input);return encode('tools/call',{name:'lifeos_call',arguments:{operationId,arguments:JSON.parse(validated.argsJSON)}});},
  async call(operationId:string,input:unknown,signal?:AbortSignal){const encoded=this.prepareCall(operationId,input);return sendPrepared(encoded,binding??'',signal);},
  async discover(input:DiscoveryInput={},signal?:AbortSignal){const args=discoverInput(input);return sendPrepared(encode('tools/call',{name:'lifeos_discover',arguments:args}),binding??'',signal);},
  sendPrepared,
 };
}
