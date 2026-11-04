import type {StoredEntry,Transaction} from '../platform/contracts.ts';
import {validateId} from '../platform/domain.ts';

export type PersonalRecordLock = Readonly<{kind:'todo'|'inbox';id:string}>;

/** One physical order for both self records and references, regardless of their logical type. */
export function personalRecordLockOrder(values:readonly PersonalRecordLock[]):PersonalRecordLock[] {
  const unique=new Map<string,PersonalRecordLock>();
  for(const value of values){
    const record={kind:value.kind,id:validateId(value.id)};
    unique.set(JSON.stringify([record.kind,record.id]),record);
  }
  return [...unique.values()].sort((a,b)=>(a.kind==='todo'?0:1)-(b.kind==='todo'?0:1)||
    Buffer.compare(Buffer.from(a.id.replaceAll('-',''),'hex'),Buffer.from(b.id.replaceAll('-',''),'hex')));
}

export async function lockPersonalRecords(tx:Transaction,values:readonly PersonalRecordLock[]):Promise<ReadonlyMap<string,StoredEntry|null>> {
  const records=new Map<string,StoredEntry|null>();
  for(const {kind,id} of personalRecordLockOrder(values))records.set(JSON.stringify([kind,id]),await tx.get(kind,id));
  return records;
}
