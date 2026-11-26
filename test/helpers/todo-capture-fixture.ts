import {createHash,randomUUID} from 'node:crypto';
import {validateTodo} from '../../src/platform/domain.ts';
import type {StoredEntry} from '../../src/platform/contracts.ts';
import type {MemoryPort} from './platform.ts';

function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en')).map(([key,item])=>JSON.stringify(key)+':'+canonical(item)).join(',')+'}';
 return JSON.stringify(value);
}

/** Synthetic persisted output of the frozen capture writers, including their original command digest. */
export async function seedTodoCapture(repo:MemoryPort,owner:string,spaceId:string,key:string,
 fields:unknown,evidence:{originalLine?:string;expression?:'written'|'spoken';channel?:'owner-web'|'agent-api'}){
 const {channel,...sourceInput}=evidence;
 const raw={spaceId,confirmed:true,fields,...sourceInput};
 const id=randomUUID(),now=new Date().toISOString();
 const original={marker:'personal-manual-v1',spaceId,type:'todo',input:raw,
  ...(channel?{capture:{version:1,channel,expression:evidence.expression??null}}:{})};
 const entry:StoredEntry={id,ownerId:owner,kind:'todo',draft:validateTodo(fields),revision:1,createdAt:now,
  updatedAt:now,syncState:'draft',externalStatus:null,source:{id:randomUUID(),system:'website',externalId:id,version:1,asOf:now,original}};
 const digest=createHash('sha256').update(canonical({action:'personal-manual-v1',owner,spaceId,type:'todo',id:null,raw})).digest('hex');
 const {ownerId:_,...publicEntry}=entry;
 await repo.transaction(owner,key,async tx=>{
  await tx.write(entry,raw,true);
  await tx.saveReceipt({digest,result:{entry:publicEntry,duplicate:false}});
 });
 return entry;
}
