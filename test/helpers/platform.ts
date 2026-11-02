import type {WindowMode,WindowPosition} from '../../src/platform/window-contracts.ts';
import {windowKey,compareWindowKeys} from '../../src/platform/window-domain.ts';
import type {PlatformRepository,Transaction,StoredEntry,Receipt} from '../../src/platform/contracts.ts';
/** Test storage/identity ports only; no validation, ownership, revisions or dedupe business rules. */
export class MemoryPort implements PlatformRepository {
 readCurrentSnapshot?:PlatformRepository['readCurrentSnapshot'];
 rows=new Map<string,StoredEntry>();receipts=new Map<string,Receipt>();events:unknown[]=[];historyRows:StoredEntry[]=[];fail=false;reads=0;
 private tail:Promise<unknown>=Promise.resolve();
 async readWindow(owner:string,mode:WindowMode,position:WindowPosition,limit:number){if(this.fail)throw Error('fixture-private-storage-error');if(limit<1||limit>101)throw Error('Unbounded test request');this.reads++;const rows=(mode==='current'?[...this.rows.values()]:this.historyRows).filter(e=>e.ownerId===owner).map(entry=>({entry:structuredClone(entry),currentRevision:this.rows.get(entry.id)?.revision??entry.revision,currentKind:this.rows.get(entry.id)?.kind??entry.kind,currentSourceId:this.rows.get(entry.id)?.source.id??entry.source.id,key:windowKey(mode==='current'?entry.createdAt:entry.updatedAt,entry.id,mode==='current'?0:entry.revision,mode)})).filter(row=>(!position.anchor||compareWindowKeys(row.key,position.anchor)<=0)&&(!position.after||compareWindowKeys(row.key,position.after)<0)).sort((a,b)=>-compareWindowKeys(a.key,b.key)).slice(0,limit);return rows;}
 async list(_owner:string,kind:string){this.reads++;if(this.fail)throw Error('fixture-private-storage-error');return structuredClone([...this.rows.values()].filter(e=>e.kind===kind));}
 async exportSnapshot(_owner:string){return structuredClone({entries:[...this.rows.values()],history:this.historyRows});}
 async history(owner:string,kind:string,id:string){return structuredClone(this.historyRows.filter(e=>e.ownerId===owner&&e.kind===kind&&e.id===id).slice(-100).reverse());}
 async get(_owner:string,kind:string,id:string){this.reads++;if(this.fail)throw Error('fixture-private-storage-error');const e=this.rows.get(id);return e?.kind===kind?structuredClone(e):null;}
 async transaction<T>(owner:string,key:string,fn:(tx:Transaction)=>Promise<T>):Promise<T>{
  const run=async()=>{
   if(this.fail)throw Error('fixture-private-storage-error');
   const rows=structuredClone(this.rows),receipts=structuredClone(this.receipts),events=structuredClone(this.events),historyRows=structuredClone(this.historyRows);
   const tx:Transaction={peek:(kind,id)=>this.get(owner,kind,id),derivedTodo:async(id)=>structuredClone([...this.rows.values()].find(e=>e.kind==='todo'&&e.ownerId===owner&&e.inboxId===id)??null),get:(kind,id)=>this.get(owner,kind,id),refundsFor:async(id)=>structuredClone([...this.rows.values()].filter(e=>e.kind==='finance'&&'kind' in e.draft&&e.draft.kind==='refund'&&e.draft.originalEntryId===id)),receipt:async()=>structuredClone(this.receipts.get(JSON.stringify([owner,key]))??null),saveReceipt:async(value)=>{this.receipts.set(JSON.stringify([owner,key]),structuredClone(value));},write:async(entry,raw,create)=>{this.rows.set(entry.id,structuredClone(entry));this.historyRows.push(structuredClone(entry));this.events.push({id:entry.id,raw:structuredClone(raw),create});}};
   try{return await fn(tx);}catch(e){this.rows=rows;this.receipts=receipts;this.events=events;this.historyRows=historyRows;throw e;}
  };
  const result=this.tail.then(run);this.tail=result.catch(()=>undefined);return result;
 }
}
