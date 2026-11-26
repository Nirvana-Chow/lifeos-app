import {createHash} from 'node:crypto';
import type {PreviewStatus} from './preview.ts';
import {diaryJournalTextLimit,diarySourceToken,readDiarySource,type DiarySource} from './historical-diary-source.ts';
export type {DiarySource} from './historical-diary-source.ts';

export const diaryPackageFormat = 'lifeos.historical-diary.synthetic.v1';
const mapper = 'historical-diary-v1';

export type DiaryScope = Readonly<{ownerId:string;spaceId:string}>;
export type ImportedDiary = Readonly<{id:string;sourceNamespace:string;source:DiarySource;date:string;body:string;sourceDigest:string}>;
type DiaryPreviewRow = {index:number;id:string;originalId:string;sourcePath:string;sourceVersion:string;date:string;
  sourceDigest:string;status:PreviewStatus;reason:'new'|'same-source'|'repeated-row'|'changed-source'|'journal-body-limit'};
export type DiaryPreview = {mapper:typeof mapper;packageDigest:string;planDigest:string;items:DiaryPreviewRow[];
  counts:Record<PreviewStatus,number>;writesPerformed:0;importAvailable:false};
export type DiaryCommand = Readonly<{key:string;planDigest:string;selected:readonly string[]}>;
export type DiaryReceipt = Readonly<{commandKey:string;packageDigest:string;planDigest:string;
  written:readonly {id:string;sourceDigest:string}[]}>;
type StoredCommand = {digest:string;receipt:DiaryReceipt};

export interface DiaryReader {
  read(id:string):Promise<ImportedDiary|null>;
  readCommand(key:string):Promise<StoredCommand|null>;
}

export interface DiaryTransaction extends DiaryReader {
  insert(record:ImportedDiary):Promise<void>;
  insertCommand(key:string,command:StoredCommand):Promise<void>;
}

export interface DiaryStore {
  read<T>(scope:DiaryScope,run:(reader:DiaryReader)=>Promise<T>):Promise<T>;
  /** Serialize writes for this binding and commit records and command together. */
  transaction<T>(scope:DiaryScope,run:(transaction:DiaryTransaction)=>Promise<T>):Promise<T>;
}

/** The caller supplies the current binding. It never comes from the package. */
export type AuthorizeDiary = (scope:DiaryScope,source:{namespace:string;packageDigest:string},action:'preview'|'apply'|'reconcile')=>Promise<void>;

const digest = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const diarySourceDigest=(namespace:string,source:DiarySource)=>digest([namespace,source]);
const scopeId = /^[A-Za-z0-9_-]{8,80}$/;
const hexDigest = /^[a-f0-9]{64}$/;
const diaryId = /^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/;

function stableRecordId(binding:readonly string[],namespace:string,originalId:string) {
  const h=digest([mapper,binding,namespace,originalId]);
  return h.slice(0,8)+'-'+h.slice(8,12)+'-8'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);
}

function object(value:unknown,fields:readonly string[]):Record<string,unknown> {
  if (!value || typeof value!=='object' || Array.isArray(value) ||
      Object.keys(value).length!==fields.length || fields.some(field=>!Object.hasOwn(value,field))) {
    throw new Error('DIARY_INVALID_FIELDS');
  }
  return value as Record<string,unknown>;
}

function match(value:unknown,pattern:RegExp):string {
  if (typeof value!=='string' || !pattern.test(value)) throw new Error('DIARY_INVALID_FIELDS');
  return value;
}


function packageOf(input:unknown,scope:DiaryScope) {
  const binding=[match(scope.ownerId,scopeId),match(scope.spaceId,scopeId)];
  const envelope=object(input,['format','sourceNamespace','entries']);
  if (envelope.format!==diaryPackageFormat || !Array.isArray(envelope.entries) ||
      envelope.entries.length===0 || envelope.entries.length>25) throw new Error('DIARY_INVALID_PACKAGE');
  const namespace=match(envelope.sourceNamespace,diarySourceToken);
  const sources=Array.from(envelope.entries,readDiarySource);
  if (sources.reduce((size,row)=>size+Buffer.byteLength(row.body),0)>120_000) {
    throw new Error('DIARY_PACKAGE_TOO_LARGE');
  }
  const packageDigest=digest([diaryPackageFormat,mapper,namespace,sources]);
  const records=sources.map(source=>({
    id:stableRecordId(binding,namespace,source.originalId),
    sourceNamespace:namespace,source,date:source.date,body:source.body,sourceDigest:diarySourceDigest(namespace,source),
  }));
  return {binding,authority:{namespace,packageDigest},packageDigest,records};
}

type DiaryPackage = ReturnType<typeof packageOf>;
function sameRecord(current:ImportedDiary,expected:ImportedDiary) {
  try {
    return current.id===expected.id && current.sourceNamespace===expected.sourceNamespace && current.date===expected.date && current.body===expected.body &&
      current.sourceDigest===expected.sourceDigest && digest(readDiarySource(current.source))===digest(expected.source);
  } catch {
    return false;
  }
}

async function plan(batch:DiaryPackage,reader:DiaryReader):Promise<DiaryPreview> {
  const existing=new Map<string,ImportedDiary|null>();
  const variants=new Map<string,Set<string>>();
  for (const record of batch.records) {
    if (!existing.has(record.id)) {
      existing.set(record.id,await reader.read(record.id));
      variants.set(record.id,new Set());
    }
    variants.get(record.id)!.add(record.sourceDigest);
  }
  const seen=new Set<string>();
  const counts={candidate:0,duplicate:0,conflict:0,invalid:0};
  const items=batch.records.map((record,index):DiaryPreviewRow=>{
    const prior=existing.get(record.id);
    const conflict=variants.get(record.id)!.size>1 || (prior!==null && prior!==undefined && !sameRecord(prior,record));
    const reason=conflict?'changed-source':record.body.length>diaryJournalTextLimit?'journal-body-limit':prior?'same-source':seen.has(record.id)?'repeated-row':'new';
    const status=reason==='changed-source'?'conflict':reason==='journal-body-limit'?'invalid':reason==='new'?'candidate':'duplicate';
    seen.add(record.id);
    counts[status]++;
    const {originalId,sourcePath,sourceVersion,date}=record.source;
    return {index,id:record.id,originalId,sourcePath,sourceVersion,date,sourceDigest:record.sourceDigest,status,reason};
  });
  return {mapper,packageDigest:batch.packageDigest,planDigest:digest([mapper,batch.binding,batch.packageDigest,items]),
    items,counts,writesPerformed:0,importAvailable:false};
}

function commandOf(command:DiaryCommand,batch:DiaryPackage) {
  const raw=object(command,['key','planDigest','selected']);
  const key=match(raw.key,/^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/);
  const planDigest=match(raw.planDigest,hexDigest);
  if (!Array.isArray(raw.selected) || raw.selected.length===0 || raw.selected.length>batch.records.length) {
    throw new Error('DIARY_INVALID_SELECTION');
  }
  const selected=Array.from(raw.selected,id=>match(id,diaryId)).sort();
  if (new Set(selected).size!==selected.length) throw new Error('DIARY_INVALID_SELECTION');
  return {key,planDigest,selected,digest:digest([mapper,batch.binding,batch.packageDigest,planDigest,selected])};
}

export class SyntheticDiaryImport {
  private readonly store:DiaryStore;
  private readonly authorize:AuthorizeDiary;

  constructor(store:DiaryStore,authorize:AuthorizeDiary) {
    this.store=store;
    this.authorize=authorize;
  }

  async preview(scope:DiaryScope,input:unknown):Promise<DiaryPreview> {
    const batch=packageOf(input,scope);
    await this.authorize(scope,batch.authority,'preview');
    const result=await this.store.read(scope,reader=>plan(batch,reader));
    await this.authorize(scope,batch.authority,'preview');
    return result;
  }

  async apply(scope:DiaryScope,input:unknown,reviewed:DiaryCommand) {
    const batch=packageOf(input,scope), command=commandOf(reviewed,batch);
    await this.authorize(scope,batch.authority,'apply');
    const outcome=await this.store.transaction(scope,async tx=>{
      await this.authorize(scope,batch.authority,'apply');
      const prior=await tx.readCommand(command.key);
      if (prior) {
        if (prior.digest!==command.digest) throw new Error('DIARY_COMMAND_CONFLICT');
        return {replayed:true,writesPerformed:0};
      }
      const current=await plan(batch,tx);
      if (current.planDigest!==command.planDigest) throw new Error('DIARY_PREVIEW_CHANGED');
      const candidates=new Map(current.items.filter(item=>item.status==='candidate').map(item=>[item.id,item.index]));
      const written=command.selected.map(id=>{
        const index=candidates.get(id);
        if (index===undefined) throw new Error('DIARY_INVALID_SELECTION');
        return batch.records[index];
      });
      for (const record of written) await tx.insert(record);
      const receipt={commandKey:command.key,packageDigest:batch.packageDigest,planDigest:command.planDigest,
        written:written.map(({id,sourceDigest})=>({id,sourceDigest}))};
      await tx.insertCommand(command.key,{digest:command.digest,receipt});
      await this.authorize(scope,batch.authority,'apply');
      return {replayed:false,writesPerformed:written.length};
    });
    const proof=await this.reconcile(scope,input,reviewed);
    if (proof.state!=='verified') throw new Error('DIARY_RESULT_UNCONFIRMED');
    return {...outcome,receipt:proof.receipt};
  }

  async reconcile(scope:DiaryScope,input:unknown,reviewed:DiaryCommand):Promise<
    {state:'unconfirmed'}|{state:'verified';receipt:DiaryReceipt}
  > {
    const batch=packageOf(input,scope), command=commandOf(reviewed,batch);
    await this.authorize(scope,batch.authority,'reconcile');
    const result=await this.store.read(scope,async reader=>{
      const prior=await reader.readCommand(command.key);
      if (!prior) return {state:'unconfirmed'} as const;
      if (prior.digest!==command.digest) throw new Error('DIARY_COMMAND_CONFLICT');
      const receipt=prior.receipt, records=new Map(batch.records.map(record=>[record.id,record]));
      if (receipt.commandKey!==command.key || receipt.packageDigest!==batch.packageDigest ||
          receipt.planDigest!==command.planDigest ||
          JSON.stringify(receipt.written.map(row=>row.id))!==JSON.stringify(command.selected)) {
        throw new Error('DIARY_RECEIPT_MISMATCH');
      }
      for (const row of receipt.written) {
        const expected=records.get(row.id),current=await reader.read(row.id);
        if (!expected || row.sourceDigest!==expected.sourceDigest || !current || !sameRecord(current,expected)) {
          throw new Error('DIARY_READBACK_MISMATCH');
        }
      }
      return {state:'verified',receipt} as const;
    });
    await this.authorize(scope,batch.authority,'reconcile');
    return result;
  }
}
