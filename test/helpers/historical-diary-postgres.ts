import {createHash} from 'node:crypto';
import type {DiaryReader,DiaryReceipt,DiaryScope,DiaryStore,DiaryTransaction,ImportedDiary} from '../../src/import-preview/historical-diary.ts';
import {historicalDiaryFields,readHistoricalDiaryEvidence} from '../../src/import-preview/historical-diary-source.ts';
import {validatePersonalBody} from '../../src/personal-candidate/service.ts';
import type {PlatformRepository,PublicEntry,StoredEntry,Transaction} from '../../src/platform/contracts.ts';

type JournalRead=(id:string)=>Promise<PublicEntry|null>;

function readDiary(entry:PublicEntry|StoredEntry|null,scope:DiaryScope):ImportedDiary|null {
 if(!entry)return null;
 const original=entry.source.original as {spaceId?:unknown;type?:unknown;historicalDiary?:unknown;input?:{fields?:unknown}};
 if(original?.spaceId!==scope.spaceId||original.type!=='journal'||!original.historicalDiary)throw Error('DIARY_NATIVE_IDENTITY_CONFLICT');
 const {source,namespace,sourceDigest}=readHistoricalDiaryEvidence(original.historicalDiary,original.input?.fields);
 const draft=entry.draft;
 if(!('text'in draft)||draft.text!==source.body||draft.occurredOn!==source.date)throw Error('DIARY_NATIVE_RECORD_CHANGED');
 return {id:entry.id,sourceNamespace:namespace,source,date:source.date,body:source.body,sourceDigest};
}

function commandEntry(record:ImportedDiary,scope:DiaryScope):StoredEntry {
 const fields=historicalDiaryFields(record.source);
 const input=validatePersonalBody('journal',null,{spaceId:scope.spaceId,confirmed:true,fields},scope.spaceId);
 const now=new Date().toISOString();
 return {
  id:record.id,ownerId:scope.ownerId,kind:'inbox',revision:1,createdAt:now,updatedAt:now,syncState:'draft',externalStatus:null,
  draft:{...fields,disposition:'reference'},
  source:{id:record.id,system:'website',externalId:record.id,version:1,asOf:now,original:{
   marker:'personal-manual-v1',spaceId:scope.spaceId,type:'journal',input,
   historicalDiary:{namespace:record.sourceNamespace,source:record.source,sourceDigest:record.sourceDigest},
  }},
 };
}

/** Synthetic-only bridge to the actual scoped repository. No route, CLI, or production composition calls this. */
export function journalQualificationStore(repository:PlatformRepository,scope:DiaryScope,readJournal:JournalRead,key?:string,
 faults:{interrupt?:boolean;loseResponse?:boolean}={}):DiaryStore {
 function checkScope(candidate:DiaryScope) {
  if(candidate.ownerId!==scope.ownerId||candidate.spaceId!==scope.spaceId)throw Error('DIARY_FIXTURE_BINDING_DENIED');
 }
 function commandKey() {
  if(!key)throw Error('DIARY_FIXTURE_COMMAND_REQUIRED');
  return 'historical-diary-v1.'+createHash('sha256').update(JSON.stringify([scope.spaceId,key])).digest('hex');
 }
 async function readCommand(tx:Transaction,requested:string) {
  if(requested!==key)throw Error('DIARY_FIXTURE_COMMAND_MISMATCH');
  const native=await tx.receipt();
  if(!native)return null;
  const diary=(native.result as {historicalDiaryReceipt?:DiaryReceipt}).historicalDiaryReceipt;
  if(!diary)throw Error('DIARY_NATIVE_RECEIPT_MISMATCH');
  return {digest:native.digest,receipt:diary};
 }
 return {
  async read(candidate,run) {
   checkScope(candidate);
   const reader:DiaryReader={
    read:async id=>readDiary(await readJournal(id),scope),
    readCommand:requested=>repository.transaction(scope.ownerId,commandKey(),tx=>readCommand(tx,requested)),
   };
   return run(reader);
  },
  async transaction(candidate,run) {
   checkScope(candidate);
   const outcome=await repository.transaction(scope.ownerId,commandKey(),async tx=>{
    if(!tx.lockRecordIdentity)throw Error('DIARY_NATIVE_LOCK_UNAVAILABLE');
    await tx.lockRecordIdentity('inbox','historical-diary-v1.'+scope.spaceId);
    let first:PublicEntry|undefined;
    const writer:DiaryTransaction={
     read:async id=>readDiary(await tx.peek('inbox',id),scope),
     readCommand:requested=>readCommand(tx,requested),
     insert:async record=>{
      const row=commandEntry(record,scope);
      await tx.write(row,row.source.original,true);
      const {ownerId,...entry}=row;
      void ownerId;
      first??=entry;
      if(faults.interrupt)throw Error('DIARY_FIXTURE_INTERRUPTED');
     },
     insertCommand:async(requested,command)=>{
      if(requested!==key||!first)throw Error('DIARY_NATIVE_RECEIPT_MISMATCH');
      const result={entry:first,duplicate:false,historicalDiaryReceipt:command.receipt};
      await tx.saveReceipt({digest:command.digest,result});
     },
    };
    return run(writer);
   });
   if(faults.loseResponse)throw Error('DIARY_FIXTURE_RESPONSE_LOST');
   return outcome;
  },
 };
}
