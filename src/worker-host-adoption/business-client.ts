import {spawn} from 'node:child_process';
import {z} from 'zod';
import type {OperationResult,CapabilityCatalog} from '../mcp-candidate/client.ts';
import {validateLocalArguments} from '../mcp-candidate/client.ts';
import {checkedPin,type CodePin} from './private-files.ts';

const resultSchema=z.strictObject({ok:z.boolean(),status:z.number().int().min(0).max(599),data:z.record(z.string(),z.unknown()).optional(),error:z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).optional(),outcome:z.literal('unknown').optional(),recovery:z.strictObject({requestId:z.uuid(),exactRetryRequired:z.literal(true)}).optional(),verification:z.record(z.string(),z.unknown()).optional(),readback:z.record(z.string(),z.unknown()).optional()});
const commands=new Set(['getRequirement','claimRequirementExecution','updateRequirementExecution']);
/** Host-only. The model receives the assigned channel, never this adapter. The
 * original client owns credential gates, original-body/key journals and GET readback. */
export function createPinnedWorkerClient(options:{entry:CodePin;timeoutMs?:number}){
 const timeoutMs=options.timeoutMs??180000;if(!Number.isInteger(timeoutMs)||timeoutMs<10||timeoutMs>180000)throw Error('WORKER_CLIENT_LIMIT_REJECTED');
 async function invoke(args:string[],input:unknown,write:boolean):Promise<unknown>{
  await checkedPin(options.entry);
  return new Promise((resolve,reject)=>{
   const child=spawn(options.entry.binary,args,{env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8',NODE_ENV:'production'},stdio:['pipe','pipe','pipe']});
   let size=0,errors=0,spawned=false,closed=false,uncertain=false;const chunks:Buffer[]=[];
   const terminate=()=>{uncertain=true;child.kill('SIGTERM');};
   const timer=setTimeout(terminate,timeoutMs),hard=setTimeout(()=>{if(!closed){uncertain=true;child.kill('SIGKILL');}},timeoutMs+500);
   child.once('spawn',()=>{spawned=true;});child.on('error',()=>{});child.stdin.on('error',()=>{});
   child.stdout.on('data',(b:Buffer)=>{size+=b.length;if(size>8*1024*1024)terminate();else chunks.push(b);});
   child.stderr.on('data',(b:Buffer)=>{errors+=b.length;if(errors>65536)terminate();});
   child.once('close',code=>{
    closed=true;clearTimeout(timer);clearTimeout(hard);
    try{if(uncertain||![0,1,2].includes(code??-1))throw Error();const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));resolve(value);}
    catch{if(write&&spawned)resolve({ok:false,status:0,error:'WORKER_CLIENT_UNCERTAIN',outcome:'unknown'});else reject(Error('WORKER_CLIENT_REJECTED'));}
   });
   child.stdin.end(input===undefined?undefined:JSON.stringify(input));
  });
 }
 async function result(args:string[],input:unknown,write:boolean):Promise<OperationResult>{
  const value=await invoke(args,input,write),parsed=resultSchema.safeParse(value);
  if(!parsed.success){if(write)return{ok:false,status:0,error:'WORKER_CLIENT_UNCERTAIN',outcome:'unknown'};throw Error('WORKER_CLIENT_REJECTED');}
  return parsed.data as OperationResult;
 }
 return{
  async discover():Promise<CapabilityCatalog>{const value=await invoke(['discover'],undefined,false);if(!value||typeof value!=='object'||(value as any).apiVersion!=='2'||!Array.isArray((value as any).operations))throw Error('WORKER_DISCOVERY_REJECTED');return value as CapabilityCatalog;},
  async execute(id:string,input:unknown){if(!commands.has(id))throw Error('WORKER_OPERATION_REJECTED');validateLocalArguments(id,input);return result(['call',id],input,id!=='getRequirement');},
  async retry(requestId:string){if(!z.uuid().safeParse(requestId).success)throw Error('WORKER_RECOVERY_REJECTED');return result(['retry',requestId],undefined,true);},
 };
}
