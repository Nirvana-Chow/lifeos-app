import type {EventActor,EventStore,EventTransaction,Work,WorkEvent,ExecutionLease} from '../../src/requirement-events/contracts.ts';
/** Transaction/storage ports only; production service owns leases and command receipts. */
export class MemoryRequirementEvents implements EventStore{
 rows=new Map<string,Work>();commands=new Map<string,{digest:string;lease:ExecutionLease}>();events:WorkEvent[]=[];now=Date.now();allowed=true;private tail:Promise<unknown>=Promise.resolve();
 async transaction<T>(actor:EventActor,operationId:string,run:(tx:EventTransaction)=>Promise<T>):Promise<T>{
  const job=async()=>{if(!this.allowed)throw Error('synthetic-grant-revoked');const rows=structuredClone(this.rows),commands=structuredClone(this.commands);try{return await run({now:async()=>this.now,get:async id=>structuredClone(this.rows.get(id)??null),put:async row=>{this.rows.set(row.requirementId,structuredClone(row));},replay:async(after,limit)=>({events:structuredClone(this.events.filter(x=>BigInt(x.cursor)>BigInt(after)).slice(0,limit)),cursor:this.events.at(-1)?.cursor??'0',reset:false}),ready:async limit=>structuredClone([...this.rows.values()].slice(0,limit)),claimReceipt:async key=>structuredClone(this.commands.get(key)??null),saveClaimReceipt:async(key,value)=>{this.commands.set(key,structuredClone(value));}});}catch(error){this.rows=rows;this.commands=commands;throw error;}};const result=this.tail.then(job);this.tail=result.catch(()=>{});return result;
 }
}
