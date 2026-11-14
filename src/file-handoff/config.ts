import {resolve} from 'node:path';import {isIP} from 'node:net';
export const fileHandoffRuntimeKeys=['LIFEOS_FILE_HANDOFF','LIFEOS_FILE_HANDOFF_DIRECTORY','LIFEOS_FILE_HANDOFF_ALLOWED_ORIGINS','LIFEOS_FILE_HANDOFF_MAX_BYTES','LIFEOS_FILE_HANDOFF_MAX_RESERVED_BYTES','LIFEOS_FILE_HANDOFF_SOURCE_TIMEOUT_MS'] as const;
export function readFileHandoffConfig(env:Record<string,string|undefined>){
 if(fileHandoffRuntimeKeys.every(key=>env[key]===undefined))return null;
 try{
  const directory=env.LIFEOS_FILE_HANDOFF_DIRECTORY,origins:unknown=JSON.parse(env.LIFEOS_FILE_HANDOFF_ALLOWED_ORIGINS??'null');
  if(env.LIFEOS_FILE_HANDOFF!=='file-handoff-v1'||!directory||resolve(directory)!==directory||!Array.isArray(origins)||origins.length<1||origins.length>8||new Set(origins).size!==origins.length)throw Error();
  for(const origin of origins){if(typeof origin!=='string')throw Error();const url=new URL(origin);if(url.origin!==origin||url.protocol!=='https:'||url.port||url.username||url.password||isIP(url.hostname)||url.hostname.endsWith('.'))throw Error();}
  const integer=(key:string,fallback:number,min:number,max:number)=>{const raw=env[key];if(raw!==undefined&&!/^[1-9]\d*$/.test(raw))throw Error();const value=raw===undefined?fallback:Number(raw);if(!Number.isSafeInteger(value)||value<min||value>max)throw Error();return value;};
  const maxBytes=integer('LIFEOS_FILE_HANDOFF_MAX_BYTES',16*1024*1024,1,32*1024*1024);
  return Object.freeze({directory,allowedOrigins:Object.freeze(origins as string[]),maxBytes,maxReservedBytes:integer('LIFEOS_FILE_HANDOFF_MAX_RESERVED_BYTES',256*1024*1024,maxBytes,1024*1024*1024),timeoutMs:integer('LIFEOS_FILE_HANDOFF_SOURCE_TIMEOUT_MS',30000,1,30000)});
 }catch{throw Error('FILE_HANDOFF_CONFIG_UNAVAILABLE');}
}
