import type {RecordFields,RecordMutationResult,RecordEntry,ProjectReview} from '../records-candidate/contracts.ts';
import {RecordsClient,RecordRequestError,createRecordCommand,createProjectReviewCommand,type RecordCommand,type RecordTarget} from './client.ts';
import type {RecordsCommandStore} from './recovery.ts';
export type RecordsSaveState={phase:'idle'|'saving'|'uncertain'|'rejected'|'conflict'|'saved';pending:RecordCommand|null;attempt:RecordCommand|null;result:RecordMutationResult|null;error:RecordRequestError|null};
const initial=():RecordsSaveState=>({phase:'idle',pending:null,attempt:null,result:null,error:null});
export class RecordsSaveSession{
 private state=initial();private listeners=new Set<()=>void>();private wasUncertain=false;private client:RecordsClient;private key:()=>string;private store?:RecordsCommandStore;
 constructor(client:RecordsClient,key:()=>string=()=> 'records-ui-'+crypto.randomUUID(),store?:RecordsCommandStore){this.client=client;this.key=key;this.store=store;const pending=store?.load();if(pending){this.wasUncertain=true;this.state={...initial(),phase:'uncertain',pending,attempt:pending};}}
 getSnapshot=()=>this.state;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private publish(state:RecordsSaveState){this.state=Object.freeze(state);for(const listener of this.listeners)listener();}
 reset(){if(this.state.pending||this.state.phase==='saving')throw Error('请先确认当前保存结果，再开始其他操作。');this.wasUncertain=false;this.publish(initial());}
 async save(fields:RecordFields,target:RecordTarget|null,confirmed:boolean):Promise<void>{
  const captured=structuredClone(fields),capturedTarget=target?structuredClone(target):null;
  await this.submit(ownerId=>createRecordCommand(captured,capturedTarget,this.key(),confirmed,ownerId));
 }
 async review(entry:RecordEntry,decision:Exclude<ProjectReview['decision'],'pending'>,evidence:string,confirmed:boolean):Promise<void>{
  const captured=structuredClone(entry);
  await this.submit(ownerId=>createProjectReviewCommand(captured,decision,evidence,this.key(),confirmed,ownerId));
 }
 private async submit(build:(ownerId:string)=>RecordCommand):Promise<void>{
  if(this.state.pending||this.state.phase==='saving')throw Error('请先确认当前保存结果，再开始其他操作。');
  this.publish({...initial(),phase:'saving'});
  let command:RecordCommand;
  try{command=build(await this.client.identity());this.store?.keep(command);}catch(cause){const error=cause instanceof RecordRequestError?cause:new RecordRequestError(0,'NOT_SENT',cause instanceof Error?cause.message:'请求尚未发送。');this.publish({...initial(),phase:'rejected',error});throw error;}
  this.wasUncertain=false;this.publish({...initial(),phase:'saving',pending:command,attempt:command});await this.execute(command);
 }
 async retry():Promise<void>{if(!this.state.pending||this.state.phase==='saving')return;const command=this.state.pending;this.publish({...this.state,phase:'saving',error:null});await this.execute(command);}
 private async execute(command:RecordCommand):Promise<void>{
  try{const result=await this.client.send(command);this.store?.clear(command.key);this.wasUncertain=false;this.publish({...this.state,phase:'saved',pending:null,result,error:null});}
  catch(cause){const error=cause instanceof RecordRequestError?cause:new RecordRequestError(0,'UNKNOWN_RESULT','保存结果未确认，请重试原请求。',true);
   // Any later rejection describes only that attempt; it cannot disprove an earlier commit.
   let uncertain=this.wasUncertain||error.uncertain||error.status===401||error.status===403;if(!uncertain){try{this.store?.clear(command.key);}catch{uncertain=true;}}
   this.wasUncertain=uncertain;this.publish({...this.state,phase:uncertain?'uncertain':error.code==='REVISION_CONFLICT'?'conflict':'rejected',pending:uncertain?command:null,error});
  }
 }
}
