import {mkdir,lstat,open,readFile,rename,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,join,isAbsolute,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {requirementId} from '../requirements-candidate/domain.ts';
import {validateId} from '../platform/domain.ts';
import {cursor} from './service.ts';
import type {ExecutionLease,Work} from './contracts.ts';
type QueueItem={key:string;ticket:Work;requestId:string;state:'queued'|'claiming'|'running'|'uncertain';lease?:ExecutionLease};
type QueueState={version:1;cursor:string;pending:QueueItem[];completed:string[]};
const ticketKey=(work:Work)=>[work.requirementId,work.sourceId,work.workDigest,work.fence].join('/');
function checkedWork(work:Work){
 if(!work||Object.keys(work).some(key=>!['requirementId','sourceId','revision','workDigest','state','attempts','fence','lease'].includes(key)))throw Error('INVALID_WORK');
 requirementId(work.requirementId);validateId(work.sourceId);
 if(!/^[a-f0-9]{64}$/.test(work.workDigest)||!Number.isSafeInteger(work.revision)||work.revision<1||!Number.isSafeInteger(work.fence)||work.fence<0||work.state!=='ready'||work.lease!==null||!Number.isInteger(work.attempts)||work.attempts<0||work.attempts>=3)throw Error('INVALID_WORK');
}
async function privateDirectory(path:string){if(!isAbsolute(path)||resolve(path)!==path)throw Error('ABSOLUTE_PRIVATE_STATE_REQUIRED');await mkdir(path,{recursive:true,mode:0o700});const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid?.()||info.mode&0o077)throw Error('UNSAFE_QUEUE_DIRECTORY');}
async function atomic(path:string,value:unknown){const temporary=path+'.'+randomUUID(),fd=await open(temporary,'wx',0o600);try{await fd.writeFile(JSON.stringify(value));await fd.sync();}finally{await fd.close();}await rename(temporary,path);const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}}
async function lock<T>(directory:string,name:string,run:()=>Promise<T>){
 await privateDirectory(directory);const path=join(directory,name);const take=async()=>{const fd=await open(path,'wx',0o600);try{await fd.writeFile(JSON.stringify({pid:process.pid}));await fd.sync();}finally{await fd.close();}};
 try{await take();}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const recovery=await open(path+'.recover','wx',0o600);try{const info=await lstat(path);if(!info.isFile()||info.nlink!==1||info.uid!==process.getuid?.()||info.mode&0o077||info.size>128)throw Error('UNSAFE_QUEUE_LOCK');const previous=JSON.parse(await readFile(path,'utf8'));if(!Number.isSafeInteger(previous.pid)||previous.pid<1)throw Error('INVALID_QUEUE_LOCK');try{process.kill(previous.pid,0);throw Error('DISPATCHER_ALREADY_RUNNING');}catch(cause){if((cause as NodeJS.ErrnoException).code!=='ESRCH')throw cause;}await unlink(path);await take();}finally{await recovery.close();await unlink(path+'.recover');}}
 try{return await run();}finally{await unlink(path);}
}
export class DurableRequirementQueue{
 readonly directory:string;readonly capacity:number;private tail:Promise<unknown>=Promise.resolve();
 constructor(directory:string,capacity=128){if(!Number.isInteger(capacity)||capacity<1||capacity>1000)throw Error('INVALID_QUEUE_CAPACITY');this.directory=directory;this.capacity=capacity;}
 private async read():Promise<QueueState>{
  const path=join(this.directory,'queue.json');let fd;try{fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return{version:1,cursor:'0',pending:[],completed:[]};throw error;}
  try{const info=await fd.stat();if(!info.isFile()||info.nlink!==1||info.uid!==process.getuid?.()||info.mode&0o077||info.size>2*1024*1024)throw Error('UNSAFE_QUEUE_STATE');const value=JSON.parse(await fd.readFile('utf8')) as QueueState;cursor(value.cursor);if(value.version!==1||!Array.isArray(value.pending)||!Array.isArray(value.completed)||value.pending.length>this.capacity||value.completed.length>1000)throw Error('INVALID_QUEUE_STATE');for(const item of value.pending){checkedWork(item.ticket);if(item.key!==ticketKey(item.ticket)||!['queued','claiming','running','uncertain'].includes(item.state)||!/^claim-[a-f0-9-]{36}$/.test(item.requestId))throw Error('INVALID_QUEUE_STATE');}return value;}finally{await fd.close();}
 }
 private edit<T>(run:(state:QueueState)=>T|Promise<T>,save=true):Promise<T>{const task=()=>lock(this.directory,'queue.lock',async()=>{const state=await this.read(),result=await run(state);if(save)await atomic(join(this.directory,'queue.json'),state);return result;});const result=this.tail.then(task);this.tail=result.catch(()=>undefined);return result;}
 snapshot(){return this.edit(state=>structuredClone(state),false);}
 ingest(batch:{cursor:string;ready:readonly Work[]}){return this.edit(state=>{const next=cursor(batch.cursor);if(BigInt(next)<BigInt(state.cursor))throw Error('EVENT_CURSOR_ROLLBACK');if(batch.ready.length>100)throw Error('EVENT_BATCH_TOO_LARGE');for(const work of batch.ready){checkedWork(work);const key=ticketKey(work);if(!state.pending.some(item=>item.key===key)&&!state.completed.includes(key)){if(state.pending.length>=this.capacity)throw Error('QUEUE_FULL');state.pending.push({key,ticket:structuredClone(work),requestId:'claim-'+randomUUID(),state:'queued'});}}state.cursor=next;});}
 update(key:string,change:Partial<Pick<QueueItem,'state'|'lease'>>){return this.edit(state=>{const item=state.pending.find(row=>row.key===key);if(!item)throw Error('QUEUE_ITEM_MISSING');Object.assign(item,change);});}
 finish(key:string){return this.edit(state=>{state.pending=state.pending.filter(row=>row.key!==key);state.completed=[...state.completed.filter(value=>value!==key),key].slice(-1000);});}
 withDispatcher<T>(run:()=>Promise<T>){return lock(this.directory,'dispatcher.lock',run);}
}
export type WorkerResult={outcome:'verified'|'unknown';processCompleted?:boolean};
type DispatcherOptions={queue:DurableRequirementQueue;holderId:string;slots?:number;api:{claim:(input:{requirementId:string;workDigest:string;holderId:string;requestId:string})=>Promise<ExecutionLease>;renew:(lease:ExecutionLease)=>Promise<ExecutionLease>};worker:(work:Work,lease:ExecutionLease,signal:AbortSignal)=>Promise<WorkerResult>};
export class RequirementDispatcher{
 private options:DispatcherOptions;
 constructor(options:DispatcherOptions){if(!Number.isInteger(options.slots??0)||(options.slots??0)<0||(options.slots??0)>3)throw Error('INVALID_RESERVED_SLOTS');this.options=options;}
 async drain():Promise<number>{const o=this.options;if(!o.slots)return 0;return o.queue.withDispatcher(async()=>{
  const state=await o.queue.snapshot(),busy=new Set(state.pending.filter(item=>['running','uncertain'].includes(item.state)).map(item=>item.ticket.requirementId));
  const selected:QueueItem[]=[];for(const item of state.pending){if(selected.length>=o.slots!)break;if(!['queued','claiming'].includes(item.state)||busy.has(item.ticket.requirementId))continue;busy.add(item.ticket.requirementId);selected.push(item);}
  let launched=0;
  await Promise.all(selected.map(async item=>{
   await o.queue.update(item.key,{state:'claiming'});let lease:ExecutionLease;
   try{lease=await o.api.claim({requirementId:item.ticket.requirementId,workDigest:item.ticket.workDigest,holderId:o.holderId,requestId:item.requestId});}catch(error){const status=(error as {status?:number})?.status,code=(error as {code?:string})?.code;if(status===409||['REQUIREMENT_WORK_CHANGED','EXECUTION_ATTEMPTS_EXHAUSTED','EXECUTION_ALREADY_CLAIMED'].includes(code??''))await o.queue.finish(item.key);return;}
   if(lease.requirementId!==item.ticket.requirementId||lease.sourceId!==item.ticket.sourceId||lease.workDigest!==item.ticket.workDigest||lease.holderId!==o.holderId||lease.expiresAt<=Date.now()){await o.queue.finish(item.key);return;}
   // Claim receipts are historical. Only a fresh server-side renew proves current ownership before model launch.
   try{lease=await o.api.renew(lease);}catch(error){if((error as {status?:number})?.status===409||(error as {code?:string})?.code==='EXECUTION_LEASE_LOST')await o.queue.finish(item.key);return;}
   await o.queue.update(item.key,{state:'running',lease});const abort=new AbortController();let renewal:Promise<void>|undefined;
   const timer=setInterval(()=>{if(renewal)return;renewal=o.api.renew(lease).then(value=>{lease=value;}).catch(()=>{abort.abort();}).finally(()=>{renewal=undefined;});},40000);
   try{launched++;const result=await o.worker(item.ticket,lease,abort.signal);if(result.outcome==='verified'&&!abort.signal.aborted)await o.queue.finish(item.key);else await o.queue.update(item.key,{state:'uncertain'});}catch{await o.queue.update(item.key,{state:'uncertain'});}finally{clearInterval(timer);abort.abort();await renewal;}
  }));return launched;
 });}
}
export type CodexCommandConfig={binary:string;workingDirectory:string;executionLease?:ExecutionLease};
export function codexWorkerCommand(config:CodexCommandConfig,work:Work){checkedWork(work);if(config.executionLease&&(config.executionLease.requirementId!==work.requirementId||config.executionLease.sourceId!==work.sourceId||config.executionLease.workDigest!==work.workDigest))throw Error('WORKER_LEASE_MISMATCH');if(!isAbsolute(config.binary)||!isAbsolute(config.workingDirectory))throw Error('FIXED_ABSOLUTE_WORKER_PATHS_REQUIRED');const binding=config.executionLease?JSON.stringify({id:config.executionLease.id,requirementId:config.executionLease.requirementId,sourceId:config.executionLease.sourceId,revision:config.executionLease.revision,workDigest:config.executionLease.workDigest,holderId:config.executionLease.holderId,grantId:config.executionLease.grantId,fence:config.executionLease.fence,expiresAt:config.executionLease.expiresAt}):'尚未提供租约，不得执行写入';return{args:['exec','--json','--sandbox','workspace-write','--config','agents.enabled=false','--cd',config.workingDirectory,'--thread-source','lifeos-requirement-worker','-'],prompt:`执行 LifeOS 工单 ${work.requirementId}。服务端执行租约 ${binding}。先通过已审 intake/Agent Skill 回读当前需求、source/revision、执行租约及既有 Issue/OpenSpec。仅执行已派单范围；继续使用同一需求记录与原写入 key，写后独立回读。暂停、取消、弱候选不自行恢复；不得创建第二需求池或扩大凭据权限。不要启动子代理；该独立 worker 已占用父协调器预留的一个执行槽。完成情况与体验验收分开，无法核实时保留 unknown。`};}
/** Candidate only. No model process is spawned on import; callers must reserve a slot.
 * Exit0/turn.completed is not proof of a business receipt/readback. */
export async function runCodexWorker(config:CodexCommandConfig,work:Work,signal:AbortSignal):Promise<WorkerResult>{
 signal.throwIfAborted();if(!config.executionLease)throw Error('WORKER_LEASE_REQUIRED');const command=codexWorkerCommand(config,work);
 const child=spawn(config.binary,command.args,{cwd:config.workingDirectory,env:{PATH:dirname(process.execPath)+':/usr/bin:/bin',HOME:process.env.HOME,LANG:'en_US.UTF-8',TMPDIR:process.env.TMPDIR,NODE_ENV:'production'},stdio:['pipe','pipe','pipe']});
 let forced:ReturnType<typeof setTimeout>|undefined;
 const terminate=()=>{child.kill('SIGTERM');if(!forced)forced=setTimeout(()=>{child.kill('SIGKILL');},5000);};
 let size=0;const cap=(chunk:Buffer)=>{size+=chunk.length;if(size>1024*1024)terminate();};child.stdout.on('data',cap);child.stderr.on('data',cap);child.stdin.on('error',()=>{});
 const timeout=setTimeout(terminate,30*60000);signal.addEventListener('abort',terminate,{once:true});if(signal.aborted)terminate();
 try{await new Promise<void>(resolve=>{child.once('error',()=>{});child.once('close',()=>resolve());child.stdin.end(command.prompt);});return{outcome:'unknown',processCompleted:true};}finally{clearTimeout(timeout);if(forced)clearTimeout(forced);signal.removeEventListener('abort',terminate);}
}
