import{PersonalMutationSession,makePersonalCommand,type PersonalBinding,type PersonalFetch,type PersonalCommand}from'./client.ts';
import {planningKeys} from './planning.ts';
import{personalTypes,personalReferences}from'./business.ts';
import{editorFromEntry,todoDraftFromEditor,type PersonalEditorFields}from'./editor.ts';
import type{PersonalType}from'./config.ts';
import{workspaceData,type WorkspaceData,type WorkspaceTask}from'./workspace-data.ts';
import type{PublicEntry}from'../platform/contracts.ts';
export type WorkspaceState={status:'unknown'|'loading';message?:string}|{status:'error'|'forbidden';message:string}|{status:'ready';data:WorkspaceData};
export type WorkspaceAccess={authenticated:boolean|null;writable:boolean|null;loginAllowed:boolean|null;allowedTypes?:readonly PersonalType[];displayName?:string|null;message?:string|null};
export type ControllerSnapshot={state:WorkspaceState;access:WorkspaceAccess;pendingTaskIds:readonly string[];mutationError:string|null;uncertain:boolean;saving:boolean;undoDeadline:number|null};
const canonical=(v:unknown):string=>JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export class PersonalWorkspaceController{
 private value:ControllerSnapshot={state:{status:'unknown'},access:{authenticated:null,writable:null,loginAllowed:null},pendingTaskIds:[],mutationError:null,uncertain:false,saving:false,undoDeadline:null};
 private listeners=new Set<()=>void>();private generation=0;private binding:PersonalBinding|null=null;private entries:PublicEntry[]=[];private session:PersonalMutationSession|null=null;private unsubscribe?:()=>void;
 private planningReadbackRequired=false;private busy=false;private preflight:AbortController|null=null;
 private undo:{id:string;revision:number;status:WorkspaceTask['status'];deadline:number}|null=null;
 private pending:{command:PersonalCommand;base:PublicEntry|null;generation:number;session:PersonalMutationSession;priorStatus?:WorkspaceTask['status']}|null=null;
 private options:{fetcher:PersonalFetch;origin:string;storage?:Pick<Storage,'getItem'|'setItem'|'removeItem'>;today:()=>string;key:()=>string;now?:()=>number};
 constructor(options:PersonalWorkspaceController['options']){this.options=options;}
 getSnapshot=()=>this.value;subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private emit(patch:Partial<ControllerSnapshot>){this.value={...this.value,...patch};this.listeners.forEach(f=>f());}
 private clear(){this.preflight?.abort();this.preflight=null;this.clearUndo();this.pending=null;this.busy=false;this.binding=null;this.entries=[];this.unsubscribe?.();this.unsubscribe=undefined;this.session?.invalidateBinding();this.session=null;this.emit({pendingTaskIds:[],mutationError:null,uncertain:false,saving:false});}
 suspend(){++this.generation;this.clear();this.emit({state:{status:'unknown'},access:{authenticated:null,writable:null,loginAllowed:null},pendingTaskIds:[],mutationError:null,uncertain:false,saving:false});}
 private async json(path:string,signal?:AbortSignal){
  const read=async()=>{const response=await this.options.fetcher(path,{credentials:'same-origin',cache:'no-store',...(signal?{signal}:{})});const body:unknown=await response.json();return{response,body};};
  if(!signal)return read();signal.throwIfAborted();
  // Settle the caller even if a transport/body ignores abort; generation still fences late results.
  let onAbort!:()=>void;const cancelled=new Promise<never>((_,reject)=>{onAbort=()=>reject(signal.reason);signal.addEventListener('abort',onAbort,{once:true});});
  try{return await Promise.race([read(),cancelled]);}finally{signal.removeEventListener('abort',onAbort);}
 }
 async refresh(){
  if(this.value.saving)return;this.clearUndo();this.pending=null;const token=++this.generation;this.entries=[];this.emit({state:{status:'loading'},access:{...this.value.access,writable:null}});
  try{
   const[c,s]=await Promise.all([this.json('/api/platform/personal/availability'),this.json('/api/platform/personal/status')]);if(token!==this.generation)return;
   const capability=c.body,loginAllowed=c.response.ok&&obj(capability)&&capability.configured===true&&capability.loginAllowed===true&&(capability.https===true&&this.options.origin.startsWith('https://')||capability.transport==='ssh-loopback'&&this.options.origin===capability.origin&&new URL(this.options.origin).hostname==='127.0.0.1');
   if(!s.response.ok){this.clear();this.emit({state:{status:s.response.status===401||s.response.status===403?'forbidden':'error',message:s.response.status===401?'请登录本人账号。':'本人空间当前不可用。'},access:{authenticated:s.response.status===401?false:null,writable:false,loginAllowed}});return;}
   const status=s.body;if(!obj(status)||status.scope!=='personal-manual-candidate'||status.storageVerified!==true||typeof status.ownerId!=='string'||typeof status.spaceId!=='string'||!Array.isArray(status.allowedTypes)||!status.allowedTypes.every(type=>typeof type==='string'&&personalTypes.includes(type as PersonalType))||!status.allowedTypes.includes('todo'))throw Error('本人身份无法核实。');
   const next={ownerId:status.ownerId,spaceId:status.spaceId};if(this.binding&&(this.binding.ownerId!==next.ownerId||this.binding.spaceId!==next.spaceId)){this.clear();throw Error('本人身份或空间发生变化，请重新读取。');}
   this.binding=next;if(!this.session){const session=new PersonalMutationSession({binding:next,fetcher:this.options.fetcher,storage:this.options.storage,assertBinding:()=>this.binding?.ownerId===next.ownerId&&this.binding?.spaceId===next.spaceId});this.session=session;this.unsubscribe=session.subscribe(()=>this.readMutation());}
   this.emit({access:{authenticated:true,writable:status.writable===true,loginAllowed,allowedTypes:[...status.allowedTypes] as PersonalType[],displayName:'本人空间'}});this.readMutation();
   const today=this.options.today(),v=await this.json('/api/platform/personal/overview?today='+encodeURIComponent(today));if(token!==this.generation)return;if(!v.response.ok){if(v.response.status===401||v.response.status===403)this.clear();throw Error('待办读取失败。');}const checked=workspaceData(v.body,next.spaceId,today);this.entries=checked.entries;this.planningReadbackRequired=false;this.emit({state:{status:'ready',data:checked.data}});
  }catch(error){if(token===this.generation){this.clear();this.emit({state:{status:'error',message:error instanceof Error?error.message:'读取失败，请重试。'},access:{authenticated:null,writable:false,loginAllowed:this.value.access.loginAllowed}});}}
 }
 private readMutation(){const state=this.session?.getSnapshot();this.emit({pendingTaskIds:state?.pending?.id?[state.pending.id]:[],mutationError:state?.error||null,uncertain:state?.phase==='uncertain',saving:this.busy||state?.phase==='saving'});}
 private clearUndo(){this.undo=null;this.emit({undoDeadline:null});}
 private now(){return(this.options.now??Date.now)();}
 /** Internal editor memory scope; never rendered or persisted as a draft. */
 getEditorBinding():PersonalBinding|null{return this.value.state.status==='ready'&&this.binding?{...this.binding}:null;}
 getSpaceId():string|null{return this.value.state.status==='ready'?this.binding?.spaceId??null:null;}
 getTaskEntry(task:Pick<WorkspaceTask,'id'|'revision'>):PublicEntry|null{
  if(this.value.state.status!=='ready')return null;const e=this.entries.find(e=>e.id===task.id&&e.kind==='todo'&&e.revision===task.revision);return e?structuredClone(e):null;
 }
 getRelationOptions():Record<string,PublicEntry[]>{
  const result:Record<string,PublicEntry[]>={domain:[],project:[],topic:[]};if(this.value.state.status!=='ready'||!this.binding)return result;
  for(const e of this.entries){const type=editorFromEntry(e,this.binding.spaceId).type;if(type in result)result[type].push(structuredClone(e));}return result;
 }
 private async applyReceipt(context:NonNullable<PersonalWorkspaceController['pending']>):Promise<PublicEntry|null>{
  if(context.generation!==this.generation||context.session!==this.session||!this.binding||this.value.state.status!=='ready')return null;
  const state=context.session.getSnapshot(),saved=state.saved;if(state.phase!=='saved'||!saved)return null;
  const command=context.command,current=this.entries.find(e=>e.id===saved.id);
  if(command.id&&(saved.id!==command.id||saved.revision!==command.body.expectedRevision!+1))throw Error('保存回执的记录或版本不符，请重新读取核对。');
  const baseline=context.base??current;
  if(baseline&&(saved.kind!==baseline.kind||canonical(saved.source)!==canonical(baseline.source)))throw Error('保存回执的来源或版本不符，请重新读取核对。');
  let observed=saved;
  if('status'in saved.draft&&planningKeys.some(key=>Object.hasOwn(saved.draft,key)||baseline&&Object.hasOwn(baseline.draft,key))){
   this.planningReadbackRequired=true;
   try{
    const result=await this.json('/api/platform/personal/todo/'+saved.id,this.preflight?.signal);
    if(context.generation!==this.generation||context.session!==this.session||!this.binding||this.value.state.status!=='ready')return null;
    if(!result.response.ok||!obj(result.body)||!obj(result.body.entry))throw Error();
    observed=result.body.entry as PublicEntry;
    if(observed.id!==saved.id||observed.kind!==saved.kind||observed.revision<saved.revision||canonical(observed.source)!==canonical(saved.source)||observed.revision===saved.revision&&canonical(observed)!==canonical(saved)||editorFromEntry(observed,this.binding.spaceId).type!=='todo')throw Error();
    workspaceData({scope:'full-current-snapshot',truncated:false,total:1,items:[observed],today:this.value.state.data.today,observedAt:this.value.state.data.asOf},this.binding.spaceId,this.value.state.data.today);
   }catch{
    if(context.generation!==this.generation||context.session!==this.session)return null;
    this.planningReadbackRequired=true;throw Error('保存已有服务器回执，但排期逐条回读未确认，请重新读取后再操作。');
   }
  }
  // Confirming an original operation is independent of installing its old revision.
  // A newer authoritative snapshot stays intact even after the original key resolves.
  if(current&&current.revision>saved.revision||command.id&&!current){this.pending=null;return structuredClone(saved);}
  const already=current&&canonical(current)===canonical(observed);
  if(current&&!already&&(!command.id||current.revision!==command.body.expectedRevision))throw Error('本地版本或内容已变化，请重新读取核对。');
  const entries=this.entries.map(e=>e.id===saved.id?structuredClone(observed):e);if(!current)entries.push(structuredClone(observed));
  const data=this.value.state.data,checked=workspaceData({items:entries,total:entries.length,scope:'full-current-snapshot',truncated:false,today:data.today,observedAt:data.asOf},this.binding.spaceId,data.today);
  this.entries=checked.entries;this.planningReadbackRequired=false;
  if(context.priorStatus!==undefined&&observed.revision===saved.revision){this.undo={id:saved.id,revision:saved.revision,status:context.priorStatus,deadline:this.now()+10000};}
  this.emit({state:{status:'ready',data:checked.data},undoDeadline:this.undo?.deadline??null});this.pending=null;return structuredClone(saved);
 }
 async saveBatchTask(command:PersonalCommand):Promise<PublicEntry|null>{
  if(!this.binding||command.ownerId!==this.binding.ownerId||command.spaceId!==this.binding.spaceId||command.type!=='todo'||command.id!==null)return null;
  if(this.value.uncertain){const pending=this.session?.getSnapshot().pending;if(!pending||canonical(pending)!==canonical(command))return null;return this.retry(true);}
  const fields=command.body.fields;
  if(!('title'in fields)||!('notes'in fields))return null;
  return this.save(null,{title:fields.title,text:fields.notes,date:'',status:'open'},undefined,command);
 }
 async saveTask(task:Pick<WorkspaceTask,'id'|'revision'>|null,fields:PersonalEditorFields):Promise<PublicEntry|null>{
  const entry=task?this.getTaskEntry(task):null,previous=entry&&this.binding?editorFromEntry(entry,this.binding.spaceId).fields:null;
  const priorStatus=previous&&previous.status!==fields.status&&canonical({...previous,status:fields.status})===canonical(fields)?previous.status:undefined;
  return this.save(task,fields,priorStatus);
 }
 private async save(task:Pick<WorkspaceTask,'id'|'revision'>|null,fields:PersonalEditorFields,priorStatus?:WorkspaceTask['status'],batchCommand?:PersonalCommand):Promise<PublicEntry|null>{
  if(this.planningReadbackRequired){this.emit({mutationError:'排期回读尚未确认，请先重新读取当前记录。'});return null;}
  if(this.busy||this.value.saving||this.value.uncertain||this.value.state.status!=='ready'||!this.value.access.writable||!this.value.access.allowedTypes?.includes('todo')||!this.binding||!this.session)return null;
  const entry=task?this.getTaskEntry(task):null;if(task&&!entry){this.emit({mutationError:'记录不存在或版本已变化，请重新读取后再操作。'});return null;}
  this.busy=true;this.clearUndo();this.emit({saving:true,pendingTaskIds:task?[task.id]:[],mutationError:null});const binding=this.binding,session=this.session,token=this.generation,preflight=new AbortController();this.preflight=preflight;
  try{
   const draft=todoDraftFromEditor(fields);
   for(const {type,link} of personalReferences(draft)){const target=this.entries.find(e=>e.id===link.id);if(!target||target.source.id!==link.sourceId||target.revision!==link.revision||editorFromEntry(target,binding.spaceId).type!==type)throw Error('关联记录或版本已变化，请重新选择后保存。');}
   const check=await this.json('/api/platform/personal/status',preflight.signal);if(token!==this.generation||session!==this.session)return null;
   if(!check.response.ok||!obj(check.body)||check.body.scope!=='personal-manual-candidate'||check.body.ownerId!==binding.ownerId||check.body.spaceId!==binding.spaceId||check.body.storageVerified!==true||check.body.writable!==true||!Array.isArray(check.body.allowedTypes)||!check.body.allowedTypes.includes('todo')){this.suspend();this.emit({state:{status:'forbidden',message:'会话或写入权限已变化，请重新登录核对。'}});return null;}
   const command=makePersonalCommand(binding,'todo',task?.id??null,draft,batchCommand?.key??this.options.key(),true,task?.revision);
   if(batchCommand&&canonical(command)!==canonical(batchCommand))throw Error('保留的行请求内容不符，未发送。');
   this.pending={command,base:entry,generation:token,session,...(priorStatus!==undefined?{priorStatus}:{})};await session.submit(command,!!batchCommand);return await this.applyReceipt(this.pending??{command,base:entry,generation:token,session});
  }catch(error){if(token===this.generation)this.emit({mutationError:error instanceof Error?error.message:'操作未确认，请重新读取核对。'});return null;}
  finally{if(this.preflight===preflight)this.preflight=null;if(session===this.session&&token===this.generation)this.busy=false;if(session===this.session&&token===this.generation&&this.value.saving&&session.getSnapshot().phase!=='saving'){const state=session.getSnapshot();if(state.phase==='idle'||state.phase==='saved')this.emit({saving:false,pendingTaskIds:[]});else this.readMutation();}}
 }
 async setTaskStatus(task:Pick<WorkspaceTask,'id'|'revision'>,status:WorkspaceTask['status']){
  const entry=this.getTaskEntry(task);if(!entry){this.emit({mutationError:'版本已变化，请刷新后再操作。'});return;}
  const fields=editorFromEntry(entry,this.binding!.spaceId).fields;if(fields.status===status)return;await this.save(task,{...fields,status},fields.status);
 }
 async undoTaskStatus():Promise<void>{
  const undo=this.undo;if(!undo)return;if(this.now()>=undo.deadline){this.clearUndo();return;}
  const entry=this.getTaskEntry(undo);if(!entry){this.clearUndo();this.emit({mutationError:'记录已变化，无法撤销旧操作。'});return;}
  const fields=editorFromEntry(entry,this.binding!.spaceId).fields;await this.save(undo,{...fields,status:undo.status});
 }
 async retry(verifyReadback=false):Promise<PublicEntry|null>{
  const session=this.session;if(!session||!this.binding||this.value.state.status!=='ready'||this.value.saving||this.busy)return null;
  const command=session.getSnapshot().pending;if(!command)return null;
  const current=command.id?this.entries.find(e=>e.id===command.id)??null:null;
  const context=this.pending?{...this.pending,generation:this.generation}:{command,base:current,generation:this.generation,session};
  // Retry preserves the original command and key; it never creates a second mutation.
  let failure:string|null=null;
  try{this.busy=true;await session.retry(verifyReadback);return await this.applyReceipt(context);}catch(error){failure=error instanceof Error?error.message:'回执无法核对。';return null;}finally{if(session===this.session){this.busy=false;this.readMutation();if(failure)this.emit({mutationError:failure});}}
 }
 cancel(){++this.generation;this.preflight?.abort();this.preflight=null;this.busy=false;this.clearUndo();this.session?.cancel();this.readMutation();}
 async logout(){this.suspend();try{const response=await this.options.fetcher('/api/platform/auth/sign-out',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:'{}'});if(!response.ok)throw Error();this.emit({state:{status:'forbidden',message:'已退出。'},access:{authenticated:false,writable:false,loginAllowed:true}});}catch{this.emit({state:{status:'error',message:'退出结果未确认，请重试退出。'}});}}
}
