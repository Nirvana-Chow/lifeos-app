import {FinanceClient,FinanceRequestError,createFinanceCommand,type FinanceCommand,type FinanceEntry,type FinanceMutationResult} from './client.ts';
import type {FinanceFields} from './fields.ts';
import type {FinanceCommandStore} from './recovery.ts';
export type FinanceSaveState={phase:'idle'|'saving'|'uncertain'|'rejected'|'conflict'|'saved';pending:FinanceCommand|null;attempt:FinanceCommand|null;result:FinanceMutationResult|null;error:FinanceRequestError|null};
const initial=():FinanceSaveState=>({phase:'idle',pending:null,attempt:null,result:null,error:null});
export class FinanceSaveSession{
 private state=initial();private listeners=new Set<()=>void>();private readonly client:FinanceClient;private readonly key:()=>string;private readonly store?:FinanceCommandStore;private wasUncertain=false;
 constructor(client:FinanceClient,key:()=>string=()=> 'finance-ui-'+crypto.randomUUID(),store?:FinanceCommandStore){this.client=client;this.key=key;this.store=store;const pending=store?.load();if(pending){if(pending.owner!==client.owner)throw Error('待确认请求属于另一账号。');this.wasUncertain=true;this.state={...initial(),phase:'uncertain',pending,attempt:pending};}}
 getSnapshot=()=>this.state;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private publish(state:FinanceSaveState){this.state=state;for(const listener of this.listeners)listener();}
 reset(){if(this.state.pending)throw Error('请先确认当前保存结果，再开始其他操作。');this.wasUncertain=false;this.publish(initial());}
 async save(fields:FinanceFields,entry:Pick<FinanceEntry,'id'|'revision'>|null=null){
  if(this.state.pending)throw Error('请先确认当前保存结果，再开始其他操作。');
  const command=createFinanceCommand(fields,entry,this.key(),this.client.owner);this.store?.keep(command);this.wasUncertain=false;
  this.publish({...initial(),phase:'saving',pending:command,attempt:command});await this.execute(command);
 }
 async retry(){if(!this.state.pending||this.state.phase==='saving')return;const command=this.state.pending;this.publish({...this.state,phase:'saving',error:null});await this.execute(command);}
 private async execute(command:FinanceCommand){
  try{const result=await this.client.send(command);this.store?.clear(command.key);this.wasUncertain=false;this.publish({...this.state,phase:'saved',pending:null,result,error:null});}
  catch(cause){
   const error=cause instanceof FinanceRequestError?cause:new FinanceRequestError(0,'UNKNOWN_RESULT','保存或恢复状态尚未确认，请保留并重试同一请求。',true);
   // A later rejection (including revision conflict) cannot disprove an earlier commit.
   let unresolved=this.wasUncertain||error.uncertain;
   if(!unresolved)try{this.store?.clear(command.key);}catch{unresolved=true;}
   this.wasUncertain=unresolved;this.publish({...this.state,phase:unresolved?'uncertain':error.code==='REVISION_CONFLICT'?'conflict':'rejected',pending:unresolved?command:null,error});
  }
 }
}
