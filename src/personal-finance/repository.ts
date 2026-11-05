import {createHash} from 'node:crypto';
import {PlatformError} from '../platform/domain.ts';
import type {PlatformRepository,StoredEntry,Transaction} from '../platform/contracts.ts';
import type {FinanceBinding,FinanceMutationContext} from './contracts.ts';
import {claimsPersonalFinance,personalFinanceMarker,readPersonalFinanceEntry} from './domain.ts';

const missing=()=>new PlatformError(404,'NOT_FOUND','没有可访问的财务记录。');
/** Thin source/space boundary around the existing atomic record/history/receipt writer. */
export function personalFinanceRepository(repository:PlatformRepository,binding:FinanceBinding,context:FinanceMutationContext={}):PlatformRepository{
 const scoped=(entry:StoredEntry|null):entry is StoredEntry=>!!entry&&entry.ownerId===binding.ownerId&&claimsPersonalFinance(entry,binding.spaceId);
 const checkOwner=(owner:string)=>{if(owner!==binding.ownerId)throw missing();};
 const filter=(rows:StoredEntry[])=>rows.filter(scoped).map(row=>{readPersonalFinanceEntry(row,binding.spaceId);return row;});
 return{
  list:async(owner,kind)=>{checkOwner(owner);return kind==='finance'?filter(await repository.list(owner,kind)):[];},
  get:async(owner,kind,id)=>{checkOwner(owner);if(kind!=='finance')return null;const row=await repository.get(owner,kind,id);if(!scoped(row))return null;readPersonalFinanceEntry(row,binding.spaceId);return row;},
  history:async(owner,kind,id)=>{checkOwner(owner);return kind==='finance'?filter(await repository.history(owner,kind,id)):[];},
  exportSnapshot:async owner=>{checkOwner(owner);const snapshot=await repository.exportSnapshot(owner);return{entries:filter(snapshot.entries),history:filter(snapshot.history)};},
  transaction:async(owner,key,fn)=>{
   checkOwner(owner);
   const namespaced='personal-finance-v1:'+createHash('sha256').update(JSON.stringify([binding.spaceId,key])).digest('hex');
   return repository.transaction(owner,namespaced,async tx=>{
    const guard=async()=>{await context.assertActor?.();await context.transactionGuard?.(tx);};
    await guard();
    const lookup=async(method:'get'|'peek',kind:Parameters<Transaction['get']>[0],id:string)=>{await guard();if(kind!=='finance')return null;const row=await tx[method](kind,id);if(!scoped(row))return null;readPersonalFinanceEntry(row,binding.spaceId);return row;};
    const wrapped:Transaction={...tx,
     peek:(kind,id)=>lookup('peek',kind,id),get:(kind,id)=>lookup('get',kind,id),derivedTodo:async()=>null,
     refundsFor:async id=>{await guard();return filter(await tx.refundsFor(id));},
     receipt:async()=>{await guard();const receipt=await tx.receipt();if(receipt){readPersonalFinanceEntry(receipt.result.entry,binding.spaceId);if(!claimsPersonalFinance(receipt.result.entry,binding.spaceId))throw missing();}await guard();return receipt;},
     write:async(entry,raw,create)=>{
      await guard();if(entry.ownerId!==owner||entry.kind!=='finance')throw missing();
      if(create)entry.source={...entry.source,original:{marker:personalFinanceMarker,spaceId:binding.spaceId,fields:structuredClone(entry.draft)}};
      else if(!scoped(entry))throw missing();
      readPersonalFinanceEntry(entry,binding.spaceId);await tx.write(entry,raw,create);await guard();
     },
     saveReceipt:async receipt=>{await guard();readPersonalFinanceEntry(receipt.result.entry,binding.spaceId);await tx.saveReceipt(receipt);await guard();},
    };
    const result=await fn(wrapped);await guard();return result;
   });
  },
 };
}
