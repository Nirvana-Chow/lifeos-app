import type {CalendarRepository,CalendarTransaction,CalendarEntry,CalendarReceipt,CalendarHistory} from '../src/calendar-candidate/contracts.ts';
/** Synthetic transaction port only. Deliberately returns cross-owner rows to exercise service filtering. */
export class CalendarMemoryPort implements CalendarRepository {
 rows=new Map<string,CalendarEntry>();receipts=new Map<string,CalendarReceipt>();revisions:CalendarHistory[]=[];failWrite=false;
 private tail:Promise<unknown>=Promise.resolve();
 async list(_owner:string){return structuredClone([...this.rows.values()]);}
 async get(_owner:string,id:string){return structuredClone(this.rows.get(id)??null);}
 async history(_owner:string,id:string){return structuredClone(this.revisions.filter(r=>r.entry.id===id));}
 async exportSnapshot(_owner:string){return structuredClone({entries:[...this.rows.values()],history:this.revisions});}
 async transaction<T>(owner:string,key:string,fn:(tx:CalendarTransaction)=>Promise<T>):Promise<T>{
  const run=async()=>{const rows=structuredClone(this.rows),receipts=structuredClone(this.receipts),history=structuredClone(this.revisions);
   const tx:CalendarTransaction={get:id=>this.get(owner,id),receipt:async()=>structuredClone(this.receipts.get(JSON.stringify([owner,key]))??null),saveReceipt:async receipt=>{this.receipts.set(JSON.stringify([owner,key]),structuredClone(receipt));},write:async(entry,raw)=>{this.rows.set(entry.id,structuredClone(entry));this.revisions.push(structuredClone({entry,raw}));if(this.failWrite)throw Error('synthetic storage failure');}};
   try{return await fn(tx);}catch(error){this.rows=rows;this.receipts=receipts;this.revisions=history;throw error;}
  };const value=this.tail.then(run);this.tail=value.catch(()=>undefined);return value;
 }
}
export const calendarInput={title:' 合成日历计划 ',notes:'本人输入保持原文（合成）',schedule:{kind:'all-day',startDate:'2026-10-23',endDate:'2026-10-24'}};
