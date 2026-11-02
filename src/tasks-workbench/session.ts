import type {TasksCommandStore} from './recovery.ts';
import {TasksClient,TaskRequestError,createTaskCommand,type TaskCommand,type TaskEntry,type TaskFields,type TaskMutationResult} from './client.ts';
export type TasksSaveState={phase:'idle'|'saving'|'uncertain'|'rejected'|'conflict'|'saved';pending:TaskCommand|null;attempt:TaskCommand|null;result:TaskMutationResult|null;error:TaskRequestError|null};
const initial=():TasksSaveState=>({phase:'idle',pending:null,attempt:null,result:null,error:null});
/** In-memory command identity survives component unmounts when the host retains this session. */
export class TasksSaveSession{
 private state=initial();private listeners=new Set<()=>void>();private readonly client:TasksClient;private readonly key:()=>string;private wasUncertain=false;private readonly store?:TasksCommandStore;
 constructor(client:TasksClient,key:()=>string=()=> 'tasks-ui-'+crypto.randomUUID(),store?:TasksCommandStore){this.client=client;this.key=key;this.store=store;const pending=store?.load();if(pending){this.wasUncertain=true;this.state={...initial(),phase:'uncertain',pending,attempt:pending};}}
 getSnapshot=()=>this.state;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private publish(state:TasksSaveState){this.state=state;for(const listener of this.listeners)listener();}
 reset(){if(this.state.pending)throw Error('请先确认当前保存结果，再开始其他操作。');this.wasUncertain=false;this.publish(initial());}
 async save(fields:TaskFields,entry:Pick<TaskEntry,'id'|'revision'>|null=null):Promise<void>{
  if(this.state.pending)throw Error('请先确认当前保存结果，再开始其他操作。');
  const command=createTaskCommand(fields,entry,this.key());this.wasUncertain=false;this.store?.keep(command);
  this.publish({...initial(),phase:'saving',pending:command,attempt:command});await this.execute(command);
 }
 async retry():Promise<void>{if(!this.state.pending||this.state.phase==='saving')return;const command=this.state.pending;this.publish({...this.state,phase:'saving',error:null});await this.execute(command);}
 private async execute(command:TaskCommand):Promise<void>{
  try{const result=await this.client.send(command);this.store?.clear(command.key);this.wasUncertain=false;this.publish({...this.state,phase:'saved',pending:null,result,error:null});}
  catch(cause){
   const error=cause instanceof TaskRequestError?cause:new TaskRequestError(0,'UNKNOWN_RESULT','保存结果未确认，请重试同一请求。',true);
   // Auth rejection on a retry cannot prove that an earlier request did not commit.
   let unresolved=error.uncertain||(this.wasUncertain&&!(error.status===409&&error.code==='REVISION_CONFLICT'));
   if(!unresolved){try{this.store?.clear(command.key);}catch{unresolved=true;}}
   this.wasUncertain=unresolved;
   this.publish({...this.state,phase:unresolved?'uncertain':error.code==='REVISION_CONFLICT'?'conflict':'rejected',pending:unresolved?command:null,error});
  }
 }
}
