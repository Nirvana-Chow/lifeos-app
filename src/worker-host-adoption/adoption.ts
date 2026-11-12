import {z} from 'zod';
import {lstat,realpath,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,dirname} from 'node:path';
import {agentOperations} from '../agent-api/capabilities.ts';
import {executionLeaseSchema} from '../requirement-events/argument-schemas.ts';
import {prepareOwnedWorker,startPreparedWorker,type WorkerBinding,type WorkerAdoptionPort} from '../worker-host-candidate/owned-process.ts';
import type {WorkerAssignment} from '../worker-host-candidate/channel.ts';
import {createPinnedWorkerClient} from './business-client.ts';
import {assignmentSchema,bridgeBindingSchema,providerSummarySchema,runtimeSchema,type WorkerRuntime} from './contracts.ts';
import {checkedFile,checkedPin,privateDirectory,sha256,syncDirectory,type CodePin} from './private-files.ts';
const tools=['read_assigned','claim_assigned','renew_assigned','progress_assigned'];
type ArgvInput={cli:string;node:string;bridgeEntry:string;bindingPath:string;bindingSHA256:string;worktree:string};
const quoted=(v:string)=>JSON.stringify(v);
export function buildWorkerArgv(p:ArgvInput){
 const mcp=`mcp_servers={lifeos_assigned={command=${quoted(p.node)},args=[${[p.bridgeEntry,p.bindingPath,p.bindingSHA256].map(quoted).join(',')}],cwd=${quoted(p.worktree)},required=true,enabled_tools=[${tools.map(quoted).join(',')}]}}`;
 return[p.cli,'exec','--ignore-user-config','--model','gpt-6.1-sol','-c','model_provider="openai"','-c','forced_login_method="chatgpt"','-c','service_tier="default"',...['multi_agent','hooks','apps','remote_plugin','fast_mode'].flatMap(key=>['-c',`features.${key}=false`]),'-c','project_root_markers=[".git"]','-c',mcp,'--ephemeral','--json','--sandbox','workspace-write','--cd',p.worktree,'--thread-source','lifeos-requirement-worker','-'];
}
// Only six host-generated path/binding positions vary. Qualification covers this
// complete request policy; actual argv remains in the native per-job spec/ledger.
export const workerArgvPolicySHA256=sha256(JSON.stringify(buildWorkerArgv({cli:'<cli>',node:'<node>',bridgeEntry:'<bridge>',bindingPath:'<binding>',bindingSHA256:'<binding-sha>',worktree:'<isolated-worktree>'})));
/** Default .git discovery is explicitly pinned above. Check only project layers,
 * not the separately ignored CODEX_HOME user config. Never read their contents. */
export async function assertProjectConfigAbsent(cwd:string){
 if(await realpath(cwd)!==cwd)throw Error('WORKER_PROJECT_CONFIG_UNQUALIFIED');
 for(let path=cwd;;path=dirname(path)){
  try{await lstat(join(path,'.codex/config.toml'));throw Error('WORKER_PROJECT_CONFIG_UNQUALIFIED');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  try{const git=await lstat(join(path,'.git'));if(git.isFile()||git.isDirectory())return;throw Error('WORKER_PROJECT_CONFIG_UNQUALIFIED');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(dirname(path)===path)throw Error('WORKER_PROJECT_ROOT_REQUIRED');
 }
}
export type WorkerSlotReservation={readonly token:symbol};
/** Parent-process authority, never serialized or exposed to a model. Consumed
 * slots stay held on every outcome; operator reconciliation is separate. */
export function createParentWorkerSlots(input:{capacity:number;occupied:number}={capacity:4,occupied:4}){
 if(!Number.isInteger(input.capacity)||!Number.isInteger(input.occupied)||input.capacity<1||input.capacity>4||input.occupied<0||input.occupied>input.capacity)throw Error('WORKER_SLOT_UNAVAILABLE');
 const reservations=new WeakMap<WorkerSlotReservation,{binding:string;used:boolean}>();let remaining=Math.min(3,input.capacity-input.occupied);const requirements=new Set<string>();
 return{
  reserve(assignment:WorkerAssignment){assignmentSchema.parse(assignment);if(!remaining||requirements.has(assignment.requirementId))throw Error('WORKER_SLOT_UNAVAILABLE');remaining--;requirements.add(assignment.requirementId);const permit=Object.freeze({token:Symbol('parent-worker-slot')});reservations.set(permit,{binding:JSON.stringify(assignment),used:false});return permit;},
  consume(permit:WorkerSlotReservation,assignment:WorkerAssignment){const value=reservations.get(permit);if(!value||value.used||value.binding!==JSON.stringify(assignment))throw Error('WORKER_SLOT_UNAVAILABLE');value.used=true;},
 };
}
type Options={assignment:WorkerAssignment;runtime:WorkerRuntime;providerQualification:CodePin;slots:ReturnType<typeof createParentWorkerSlots>;reservation:WorkerSlotReservation};
const bindingOf=(a:WorkerAssignment):WorkerBinding=>({jobId:a.jobId,requirementId:a.requirementId,sourceId:a.sourceId,workDigest:a.workDigest,fence:a.fence});
async function providerGate(pin:CodePin,runtime:WorkerRuntime){
 const summary=providerSummarySchema.parse(JSON.parse((await checkedPin(pin,true)).toString('utf8'))),now=Date.now();
 if(summary.cliSHA256!==runtime.cli.sha256||summary.argvPolicySHA256!==workerArgvPolicySHA256||summary.observedAt>now||summary.expiresAt<=now||summary.expiresAt-summary.observedAt>3600000)throw Error('WORKER_PROVIDER_UNQUALIFIED');
 for(const evidence of [summary.effectiveConfig,summary.accountProjection,summary.smokeResult])await checkedPin(evidence,true);
}
async function clientGate(runtime:WorkerRuntime){
 await privateDirectory(runtime.client.root);await checkedPin(runtime.client.manifest);await checkedPin(runtime.client.binary);await checkedPin(runtime.client.entry);
 const marker=z.strictObject({schemaVersion:z.literal(1),manifestSHA256:z.literal(runtime.client.manifest.sha256),binarySHA256:z.literal(runtime.client.binary.sha256),origin:z.literal('https://lifeos.nirvanachow.com'),apiBase:z.literal('/api/platform/agent')}).parse(JSON.parse((await checkedFile(join(runtime.client.root,'adoption.json'),true,8192)).toString('utf8')));void marker;
}
export function createWorkerAdoption(options:Options):WorkerAdoptionPort{
 const assignment=Object.freeze(assignmentSchema.parse(options.assignment)),binding=bindingOf(assignment);let used=false;
 return{async prepare(input){
  if(JSON.stringify(input)!==JSON.stringify(binding))throw Error('WORKER_BINDING_REJECTED');if(used)throw Error('WORKER_ADOPTION_ALREADY_USED');used=true;
  options.slots.consume(options.reservation,assignment);const runtime=runtimeSchema.parse(options.runtime);
  await providerGate(options.providerQualification,runtime);await assertProjectConfigAbsent(runtime.worktree);
  for(const pin of [runtime.host,runtime.cli,runtime.node,runtime.bridge.entry,runtime.bridge.manifest,runtime.bridge.gate])await checkedPin(pin);
  if(runtime.bridge.manifest.binary!==join(runtime.bridge.root,'code-manifest.json')||runtime.bridge.entry.binary!==join(runtime.bridge.root,'worker-bridge-entry.mjs'))throw Error('WORKER_BRIDGE_REJECTED');
  await privateDirectory(runtime.bridge.root);await privateDirectory(runtime.jobsDirectory);await privateDirectory(runtime.assignmentsDirectory);await clientGate(runtime);
  const client=createPinnedWorkerClient({entry:runtime.client.entry}),catalog=await client.discover();
  for(const id of ['getRequirement','claimRequirementExecution','updateRequirementExecution']){const local=agentOperations.find(op=>op.id===id)!;const remote=catalog.operations.filter(op=>op.id===id);if(remote.length!==1||remote[0].method!==local.method||remote[0].path!==local.path||JSON.stringify([...remote[0].requiredScopes].sort())!==JSON.stringify([...local.requiredScopes].sort()))throw Error('WORKER_DISCOVERY_REJECTED');}
  const current=await client.execute('getRequirement',{id:assignment.requirementId}),entry=current.data?.entry as any,execution=current.data?.execution as any;
  const lease=executionLeaseSchema.safeParse(execution?.lease);
  if(!current.ok||!entry||entry.id!==assignment.requirementId||entry.sourceId!==assignment.sourceId||entry.baselineConflict===true||!execution||execution.requirementId!==assignment.requirementId||execution.sourceId!==assignment.sourceId||execution.workDigest!==assignment.workDigest||execution.revision!==entry.revision||execution.state!=='running'||execution.leaseActive!==true||execution.fence!==assignment.fence||!lease.success||lease.data.requirementId!==assignment.requirementId||lease.data.sourceId!==assignment.sourceId||lease.data.workDigest!==assignment.workDigest||lease.data.holderId!==assignment.holderId||lease.data.fence!==assignment.fence||lease.data.expiresAt<=Date.now())throw Error('WORKER_LIVE_FENCE_REJECTED');
  const jobDirectory=join(runtime.jobsDirectory,assignment.jobId);try{await lstat(jobDirectory);throw Error('WORKER_JOB_QUARANTINED');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const config=bridgeBindingSchema.parse({schemaVersion:1,assignment,host:runtime.host,jobDirectory,clientEntry:runtime.client.entry,root:runtime.bridge.root,manifestSHA256:runtime.bridge.manifest.sha256,gate:runtime.bridge.gate}),raw=JSON.stringify(config),bindingPath=join(runtime.assignmentsDirectory,assignment.jobId+'.json');
  const fd=await open(bindingPath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await fd.writeFile(raw);await fd.sync();}finally{await fd.close();}await syncDirectory(runtime.assignmentsDirectory);
  await assertProjectConfigAbsent(runtime.worktree);
  const peerArgs=[runtime.node.binary,runtime.bridge.entry.binary,bindingPath,sha256(raw)];
  return{host:runtime.host,jobDirectory,spec:{...binding,schemaVersion:1,code:runtime.cli,args:buildWorkerArgv({cli:runtime.cli.binary,node:runtime.node.binary,bridgeEntry:runtime.bridge.entry.binary,bindingPath,bindingSHA256:sha256(raw),worktree:runtime.worktree}),channelPeer:{code:runtime.node,entry:runtime.bridge.entry,args:peerArgs},workingDirectory:runtime.worktree,reservedSlots:1,maxWallMs:runtime.maxWallMs,maxOutputBytes:runtime.maxOutputBytes}};
 }};
}
/** Concrete composition. Source import/prepare never starts a model; only this
 * explicit parent call launches the single admitted original native process. */
export async function launchAdoptedWorker(options:Options,signal?:AbortSignal){signal?.throwIfAborted();const prepared=await prepareOwnedWorker(bindingOf(options.assignment),{adoption:createWorkerAdoption(options)});await assertProjectConfigAbsent(options.runtime.worktree);signal?.throwIfAborted();return startPreparedWorker(prepared,signal);}
