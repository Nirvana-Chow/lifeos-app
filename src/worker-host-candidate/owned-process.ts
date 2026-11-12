import {z} from 'zod';
import {spawn,execFile} from 'node:child_process';
import {open,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,basename,isAbsolute} from 'node:path';
import {StringDecoder} from 'node:string_decoder';

const hash=z.string().regex(/^[a-f0-9]{64}$/),path=z.string().max(4096).refine(isAbsolute);
const code=z.strictObject({binary:path,sha256:hash}),args=z.array(z.string().max(4096).refine(v=>!v.includes('\0'))).min(1).max(128);
const bindingSchema=z.strictObject({jobId:z.uuid(),requirementId:z.union([z.uuid(),z.string().regex(/^LO-[A-Z]+-[0-9]{3}$/)]),sourceId:z.uuid(),workDigest:hash,fence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER)});
export type WorkerBinding=z.infer<typeof bindingSchema>;
const peer=z.strictObject({code,entry:code,args});
const specSchema=bindingSchema.extend({schemaVersion:z.literal(1),code,args,channelPeer:peer,workingDirectory:path,reservedSlots:z.literal(1),maxWallMs:z.number().int().min(100).max(1800000),maxOutputBytes:z.number().int().min(1024).max(1048576)}).strict();
const preparedSchema=z.strictObject({host:code,jobDirectory:path,spec:specSchema});
export type PreparedWorker=z.infer<typeof preparedSchema>;
/** Root-owned adoption seam, deliberately unimplemented here. Its implementation
 * must verify the adopted 57-operation client/current discovery, original claim
 * fence, reserved parent slot and reviewed default provider/egress before it
 * constructs fixed CLI/MCP argv. A boolean file is not this qualification. */
export type WorkerAdoptionPort={prepare(binding:Readonly<WorkerBinding>):Promise<unknown>};
type Ports={adoption?:WorkerAdoptionPort;verifyPins?:(prepared:PreparedWorker)=>Promise<void>};
const admitted=new WeakSet<object>();
function deny():never{throw Error('WORKER_HOST_REJECTED');}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
const environment=()=>({PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8',NODE_ENV:'production' as const});
async function verifyCode(pin:z.infer<typeof code>){
 if(await realpath(pin.binary)!==pin.binary)deny();const fd=await open(pin.binary,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const st=await fd.stat();if(!st.isFile()||st.nlink!==1||st.mode&0o6022||st.size<=0||st.size>512*1024*1024)deny();if(createHash('sha256').update(await fd.readFile()).digest('hex')!==pin.sha256)deny();}finally{await fd.close();}
}
async function verifyPreparedPins(prepared:PreparedWorker){
 await verifyCode(prepared.host);await verifyCode(prepared.spec.code);await verifyCode(prepared.spec.channelPeer.code);await verifyCode(prepared.spec.channelPeer.entry);
 if(await realpath(prepared.spec.workingDirectory)!==prepared.spec.workingDirectory||await realpath(dirname(prepared.jobDirectory))!==dirname(prepared.jobDirectory))deny();
}
/** No process/filesystem/provider access is attempted without the adopted port. */
export async function prepareOwnedWorker(input:unknown,ports:Ports={}):Promise<Readonly<PreparedWorker>>{
 const parsed=bindingSchema.safeParse(input);if(!parsed.success)deny();if(!ports.adoption)throw Error('WORKER_ADOPTION_REQUIRED');
 const binding=freeze(parsed.data),prepared=preparedSchema.parse(await ports.adoption.prepare(binding));
 for(const name of ['jobId','requirementId','sourceId','workDigest','fence'] as const)if(prepared.spec[name]!==binding[name])deny();
 if(basename(prepared.jobDirectory)!==binding.jobId||prepared.spec.args[0]!==prepared.spec.code.binary||prepared.spec.channelPeer.args[0]!==prepared.spec.channelPeer.code.binary)deny();
 await(ports.verifyPins??verifyPreparedPins)(prepared);freeze(prepared);admitted.add(prepared);return prepared;
}
export type WorkerProcessResult={outcome:'unknown';processCompleted:boolean;quarantined:boolean;reusable:false};
/** One admitted launch, owned control pipe only. No naked-PID cancellation,
 * automatic restart, business verification or raw model stdout forwarding. */
export function startPreparedWorker(prepared:Readonly<PreparedWorker>,signal?:AbortSignal){
 if(!admitted.has(prepared))deny();signal?.throwIfAborted();admitted.delete(prepared);
 const child=spawn(prepared.host.binary,['run',prepared.jobDirectory],{env:environment(),stdio:['pipe','pipe','pipe']});
 let stopped=false,spawned=false,buffer='',total=0,final=false;const decoder=new StringDecoder('utf8');
 const cancel=()=>{if(stopped)return;stopped=true;if(!child.stdin.destroyed)child.stdin.end('{"command":"cancel"}\n');};
 child.once('spawn',()=>{spawned=true;});child.stdin.on('error',()=>{});child.once('error',()=>{});
 child.stdout.on('data',(bytes:Buffer)=>{total+=bytes.length;if(total>65536){cancel();return;}buffer+=decoder.write(bytes);let end:number;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const value=JSON.parse(line);if(value.event==='process-completed'&&value.jobId===prepared.spec.jobId&&value.state==='exited'&&value.groupEmpty===true&&value.outcome==='unknown'&&value.reusable===false)final=true;}catch{cancel();}}});
 child.stderr.on('data',(bytes:Buffer)=>{total+=bytes.length;if(total>65536)cancel();});
 signal?.addEventListener('abort',cancel,{once:true});child.stdin.write(JSON.stringify(prepared.spec)+'\n');if(signal?.aborted)cancel();
 const done=new Promise<WorkerProcessResult>(resolve=>child.once('close',status=>{signal?.removeEventListener('abort',cancel);resolve({outcome:'unknown',processCompleted:spawned,quarantined:status!==0||!final,reusable:false});}));
 return{cancel,done};
}
/** Called by the pinned per-job MCP bridge. The native program obtains its real
 * parent PID itself and checks live job ancestry/code/argv; no PID is supplied. */
export async function attestOwnedWorker(binding:WorkerBinding,host:z.infer<typeof code>,jobDirectory:string):Promise<void>{
 bindingSchema.parse(binding);code.parse(host);if(!isAbsolute(jobDirectory)||basename(jobDirectory)!==binding.jobId)deny();await verifyCode(host);
 const output=await new Promise<string>((resolve,reject)=>execFile(host.binary,['attest',jobDirectory],{env:environment(),encoding:'utf8',maxBuffer:8192,timeout:3000},(error,stdout)=>error?reject(Error('WORKER_PEER_REJECTED')):resolve(stdout)));
 const value=bindingSchema.extend({attested:z.literal(true)}).strict().safeParse(JSON.parse(output));if(!value.success)deny();for(const name of ['jobId','requirementId','sourceId','workDigest','fence'] as const)if(value.data[name]!==binding[name])deny();
}
