import type {SyncCapture} from '../apple-sync-candidate/capture.ts';
import {verifyRestrictedPool,type SqlPool,type SqlClient,type BoundSqlScope} from '../platform/postgres.ts';
import {PlatformError} from '../platform/domain.ts';
import type {CalendarRepository,CalendarTransaction,CalendarEntry,CalendarHistory,CalendarReceipt} from './contracts.ts';
/** Read-only readiness gate. Never applies the proposed extension migration. */
export async function verifyCalendarPool(pool:SqlPool):Promise<void>{
 await verifyRestrictedPool(pool);
 const client=await pool.connect();try{
  const result=await client.query(`SELECT (SELECT version FROM lifeos_platform.platform_calendar_meta) AS version,
   (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lifeos_platform' AND c.relname IN ('platform_calendar_event','platform_calendar_history','platform_calendar_command') AND c.relrowsecurity) AS rls_tables,
   (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lifeos_platform' AND c.relname IN ('platform_calendar_event','platform_calendar_history','platform_calendar_command') AND c.relforcerowsecurity) AS forced_tables,
   has_table_privilege(current_user,'lifeos_platform.platform_calendar_meta','SELECT') AND
   has_table_privilege(current_user,'lifeos_platform.platform_source','SELECT') AND has_table_privilege(current_user,'lifeos_platform.platform_source','INSERT') AND
   has_table_privilege(current_user,'lifeos_platform.platform_calendar_event','SELECT') AND has_table_privilege(current_user,'lifeos_platform.platform_calendar_event','INSERT') AND
   has_table_privilege(current_user,'lifeos_platform.platform_calendar_history','SELECT') AND has_table_privilege(current_user,'lifeos_platform.platform_calendar_history','INSERT') AND
   has_table_privilege(current_user,'lifeos_platform.platform_calendar_command','SELECT') AND has_table_privilege(current_user,'lifeos_platform.platform_calendar_command','INSERT') AND
   NOT EXISTS(SELECT 1 FROM unnest(ARRAY['title','notes','schedule_kind','start_date','end_date','start_at','end_at','time_zone','status','revision','updated_at']) a(column_name) WHERE NOT has_column_privilege(current_user,'lifeos_platform.platform_calendar_event',a.column_name,'UPDATE')) AS required,
   EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lifeos_platform' AND c.relname IN ('platform_calendar_meta','platform_calendar_event','platform_calendar_history','platform_calendar_command','platform_source') AND
    CASE WHEN c.relname='platform_calendar_event' THEN has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND (has_column_privilege(current_user,c.oid,a.attnum,'REFERENCES') OR (a.attname NOT IN ('title','notes','schedule_kind','start_date','end_date','start_at','end_at','time_zone','status','revision','updated_at') AND has_column_privilege(current_user,c.oid,a.attnum,'UPDATE'))))
    WHEN c.relname='platform_calendar_meta' THEN has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE,REFERENCES')
    ELSE has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(current_user,c.oid,'UPDATE,REFERENCES') END) AS excessive`);
  const m=result.rows[0];if(result.rows.length!==1||m.version!==1||m.rls_tables!==3||m.forced_tables!==3||m.required!==true||m.excessive!==false)throw Error('Restricted calendar extension v1 required');
 }finally{client.release();}
}
const select=`SELECT e.id::text,e.owner_id,e.title,e.notes,e.schedule_kind,e.start_date::text,e.end_date::text,e.start_at,e.end_at,e.time_zone,e.status,e.revision,e.created_at,e.updated_at,
 s.id::text AS source_id,s.external_id,s.version AS source_version,s.as_of,s.original
 FROM lifeos_platform.platform_calendar_event e JOIN lifeos_platform.platform_source s ON s.owner_id=e.owner_id AND s.id=e.source_id`;
const iso=(value:unknown)=>new Date(value as string).toISOString();
function decode(row:Record<string,unknown>):CalendarEntry {
 return{id:row.id as string,ownerId:row.owner_id as string,title:row.title as string,notes:row.notes as string,
  schedule:row.schedule_kind==='all-day'?{kind:'all-day',startDate:row.start_date as string,endDate:row.end_date as string}:{kind:'timed',startAt:iso(row.start_at),endAt:iso(row.end_at),timeZone:row.time_zone as string},
  status:row.status as CalendarEntry['status'],revision:row.revision as number,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),source:{id:row.source_id as string,system:'website',externalId:row.external_id as string,version:row.source_version as number,asOf:iso(row.as_of),original:row.original}};
}
const decodeHistory=(row:Record<string,unknown>):CalendarHistory=>({entry:row.snapshot as CalendarEntry,raw:row.raw});
export class PostgresCalendarRepository implements CalendarRepository {
 private pool:SqlPool;private capture?:SyncCapture;private bound?:BoundSqlScope;constructor(pool:SqlPool,capture?:SyncCapture,bound?:BoundSqlScope){this.pool=pool;this.capture=capture;this.bound=bound;}
 private async scoped<T>(owner:string,fn:(client:SqlClient)=>Promise<T>,consistent=false):Promise<T>{
  if(this.bound){if(owner!==this.bound.owner)throw Error('SYNC_OWNER_MISMATCH');return fn(this.bound.client);}
  const client=await this.pool.connect();try{await client.query(consistent?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN ISOLATION LEVEL READ COMMITTED');await client.query("SELECT set_config('lifeos.owner_id',$1,true)",[owner]);const result=await fn(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
 }
 async list(owner:string):Promise<CalendarEntry[]>{return this.scoped(owner,async client=>(await client.query(select+' WHERE e.owner_id=$1 ORDER BY e.id',[owner])).rows.map(decode));}
 async get(owner:string,id:string):Promise<CalendarEntry|null>{return this.scoped(owner,async client=>{const row=(await client.query(select+' WHERE e.owner_id=$1 AND e.id=$2',[owner,id])).rows[0];return row?decode(row):null;});}
 async history(owner:string,id:string):Promise<CalendarHistory[]>{return this.scoped(owner,async client=>(await client.query('SELECT snapshot,raw FROM lifeos_platform.platform_calendar_history WHERE owner_id=$1 AND event_id=$2 ORDER BY revision',[owner,id])).rows.map(decodeHistory));}
 async exportSnapshot(owner:string):Promise<{entries:CalendarEntry[];history:CalendarHistory[]}>{return this.scoped(owner,async client=>({entries:(await client.query(select+' WHERE e.owner_id=$1 ORDER BY e.id',[owner])).rows.map(decode),history:(await client.query('SELECT snapshot,raw FROM lifeos_platform.platform_calendar_history WHERE owner_id=$1 ORDER BY event_id,revision',[owner])).rows.map(decodeHistory)}),true);}
 async transaction<T>(owner:string,key:string,fn:(tx:CalendarTransaction)=>Promise<T>):Promise<T>{return this.scoped(owner,async client=>{
  if(this.capture)await this.capture.begin(client,owner);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['calendar',owner,key])]);
  const tx:CalendarTransaction={
   get:async id=>{const row=(await client.query(select+' WHERE e.owner_id=$1 AND e.id=$2 FOR UPDATE OF e',[owner,id])).rows[0];return row?decode(row):null;},
   receipt:async()=>{const row=(await client.query('SELECT digest,response FROM lifeos_platform.platform_calendar_command WHERE owner_id=$1 AND command_key=$2',[owner,key])).rows[0];return row?{digest:row.digest,result:row.response} as CalendarReceipt:null;},
   saveReceipt:async receipt=>{await client.query('INSERT INTO lifeos_platform.platform_calendar_command(owner_id,command_key,digest,response) VALUES($1,$2,$3,$4::jsonb)',[owner,key,receipt.digest,JSON.stringify(receipt.result)]);},
   write:async(entry,raw,create)=>{
    if(entry.ownerId!==owner)throw new PlatformError(404,'NOT_FOUND','没有可访问的日历安排。');
    const s=entry.schedule,values=[owner,entry.id,entry.title,entry.notes,s.kind,s.kind==='all-day'?s.startDate:null,s.kind==='all-day'?s.endDate:null,s.kind==='timed'?s.startAt:null,s.kind==='timed'?s.endAt:null,s.kind==='timed'?s.timeZone:null,entry.status,entry.revision,entry.updatedAt];
    if(create){
     await client.query('INSERT INTO lifeos_platform.platform_source(owner_id,id,system,external_id,version,as_of,original) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[owner,entry.source.id,entry.source.system,entry.source.externalId,entry.source.version,entry.source.asOf,JSON.stringify(entry.source.original)]);
     await client.query('INSERT INTO lifeos_platform.platform_calendar_event(owner_id,id,title,notes,schedule_kind,start_date,end_date,start_at,end_at,time_zone,status,revision,updated_at,source_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[...values,entry.source.id,entry.createdAt]);
    }else{
     const result=await client.query('UPDATE lifeos_platform.platform_calendar_event SET title=$3,notes=$4,schedule_kind=$5,start_date=$6,end_date=$7,start_at=$8,end_at=$9,time_zone=$10,status=$11,revision=$12,updated_at=$13 WHERE owner_id=$1 AND id=$2 AND revision=$14',[...values,entry.revision-1]);
     if(result.rowCount!==1)throw new PlatformError(409,'REVISION_CONFLICT','安排已更新，请读取当前版本再核对。');
    }
    await client.query('INSERT INTO lifeos_platform.platform_calendar_history(owner_id,event_id,revision,raw,snapshot,created_at) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6)',[owner,entry.id,entry.revision,JSON.stringify(raw),JSON.stringify(entry),entry.updatedAt]);
    if(this.capture)await this.capture.append(client,owner,{kind:'calendar',entityId:entry.id,sourceId:entry.source.id,revision:entry.revision,commandKey:key,snapshot:entry});
   },
  };return fn(tx);
 });}
}
