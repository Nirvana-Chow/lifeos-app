import type {AgentModules} from '../agent-api/config.ts';
import type {AgentScope} from '../agent-api/scopes.ts';
import type {AgentGrantBinding} from '../agent-api/grant-fence.ts';
import type {WindowMode,WindowPosition,WindowRow} from './window-contracts.ts';
import {windowKey} from './window-domain.ts';
import {ownerMaintenanceKey} from '../deployment-candidate/owner-maintenance-key.ts';
import type{PlatformRepository,Kind,StoredEntry,Receipt,Transaction}from'./contracts.ts';import{PlatformError}from'./domain.ts';
export interface SqlClient{query(sql:string,values?:unknown[]):Promise<{rows:Record<string,unknown>[];rowCount:number|null}>;release():void}
export interface SqlPool{connect():Promise<SqlClient>}
type Purpose='runtime'|'synthetic-bootstrap';
export function assertRestrictedMetadata(m:Record<string,unknown>,purpose:Purpose='runtime'):void{
 if(purpose!=='runtime'&&purpose!=='synthetic-bootstrap')throw Error('Restricted isolated PostgreSQL target required');
 const role=purpose==='runtime'?'lifeos_platform_candidate_runtime':'lifeos_platform_candidate_bootstrap';
 if(m.role!==role||m.superuser!==false||m.create_db!==false||m.create_role!==false||m.bypass_rls!==false||m.memberships!==0||m.owns_objects!==0||m.can_create_schema!==false||m.can_create_database!==false||m.rls_tables!==4||m.forced_tables!==4||m.version!==2)throw Error('Restricted isolated PostgreSQL target required');
}
export async function verifyRestrictedPool(pool:SqlPool,purpose:Purpose='runtime'):Promise<void>{
 const client=await pool.connect();try{
  const result=await client.query(`SELECT current_user AS role, r.rolsuper AS superuser, r.rolcreatedb AS create_db, r.rolcreaterole AS create_role, r.rolbypassrls AS bypass_rls,
   (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS memberships,
   ((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lifeos_platform' AND c.relowner=r.oid)+(SELECT count(*) FROM pg_namespace WHERE nspname='lifeos_platform' AND nspowner=r.oid)+(SELECT count(*) FROM pg_database WHERE datname=current_database() AND datdba=r.oid))::int AS owns_objects,
   EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_temp_' AND n.nspname !~ '^pg_toast_temp_' AND has_schema_privilege(current_user,n.oid,'CREATE')) AS can_create_schema,
   has_database_privilege(current_user,current_database(),'CREATE') AS can_create_database,
   (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lifeos_platform' AND c.relname IN ('platform_source','platform_record','platform_history','platform_command') AND c.relrowsecurity) AS rls_tables,
   (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lifeos_platform' AND c.relname IN ('platform_source','platform_record','platform_history','platform_command') AND c.relforcerowsecurity) AS forced_tables,
   (SELECT version FROM lifeos_platform.platform_meta) AS version FROM pg_roles r WHERE r.rolname=current_user`);
  if(result.rows.length!==1)throw Error('Restricted isolated PostgreSQL target required');assertRestrictedMetadata(result.rows[0],purpose);
  if(purpose==='synthetic-bootstrap'){
   const grants=await client.query(`SELECT
    has_table_privilege(current_user,'lifeos_platform.platform_user','SELECT') AND has_table_privilege(current_user,'lifeos_platform.platform_user','INSERT') AND
    has_table_privilege(current_user,'lifeos_platform.platform_account','SELECT') AND has_table_privilege(current_user,'lifeos_platform.platform_account','INSERT') AND has_table_privilege(current_user,'lifeos_platform.platform_meta','SELECT') AS required,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lifeos_platform' AND c.relkind IN ('r','p') AND
     CASE WHEN c.relname IN ('platform_user','platform_account') THEN has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(current_user,c.oid,'UPDATE,REFERENCES')
      WHEN c.relname='platform_meta' THEN has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE,REFERENCES')
      ELSE has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') END) AS excessive`);
   if(grants.rows.length!==1||grants.rows[0].required!==true||grants.rows[0].excessive!==false)throw Error('Restricted synthetic bootstrap grants required');
  }
 }finally{client.release();}
}
const select=`SELECT r.id::text,r.owner_id,r.kind,r.inbox_id,r.draft,r.revision,r.created_at,r.updated_at,s.id::text AS source_id,s.external_id,s.version AS source_version,s.as_of,s.original
 FROM lifeos_platform.platform_record r JOIN lifeos_platform.platform_source s ON s.owner_id=r.owner_id AND s.id=r.source_id`;
function decode(row:Record<string,unknown>):StoredEntry{
 const iso=(value:unknown)=>new Date(value as string).toISOString();
 return{id:row.id as string,ownerId:row.owner_id as string,kind:row.kind as Kind,...(row.inbox_id?{inboxId:row.inbox_id as string}:{}),draft:row.draft as StoredEntry['draft'],source:{id:row.source_id as string,system:'website',externalId:row.external_id as string,version:row.source_version as number,asOf:iso(row.as_of),original:row.original},revision:row.revision as number,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),syncState:'draft',externalStatus:null};
}
export class PostgresPlatformRepository implements PlatformRepository{
 private pool:SqlPool;private personalOwnerGate:boolean;private readonly agentWriteFenceEnabled:boolean;private readonly businessFeatures?:AgentModules;
 constructor(pool:SqlPool,personalOwnerGate=false,agentWriteFenceEnabled=false,businessFeatures?:AgentModules){this.businessFeatures=businessFeatures;this.pool=pool;this.personalOwnerGate=personalOwnerGate;this.agentWriteFenceEnabled=agentWriteFenceEnabled;}
 private async scoped<T>(owner:string,fn:(client:SqlClient)=>Promise<T>,consistentRead=false):Promise<T>{
  const client=await this.pool.connect();try{await client.query(consistentRead?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN ISOLATION LEVEL READ COMMITTED');await client.query("SELECT set_config('lifeos.owner_id',$1,true)",[owner]);const result=await fn(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
 }
 async readWindow(owner:string,mode:WindowMode,position:WindowPosition,limit:number):Promise<WindowRow[]>{
  if(!['current','history'].includes(mode)||!Number.isInteger(limit)||limit<1||limit>101)throw new PlatformError(400,'INVALID_WINDOW_QUERY','分页范围无效。');
  const {anchor,after}=position;if(anchor)windowKey(anchor.at,anchor.id,anchor.revision,mode);if(after)windowKey(after.at,after.id,after.revision,mode);
  return this.scoped(owner,async c=>{
   if(mode==='history'){
    const rows=(await c.query(`SELECT h.snapshot,r.revision AS current_revision,r.kind AS current_kind,r.source_id::text AS current_source_id,to_char(h.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS key_at,h.record_id::text AS key_id,h.revision AS key_revision FROM lifeos_platform.platform_history h JOIN lifeos_platform.platform_record r ON r.owner_id=h.owner_id AND r.id=h.record_id WHERE h.owner_id=$1 AND r.owner_id=$1 AND ($3::timestamptz IS NULL OR (h.created_at,h.record_id,h.revision)<=($3::timestamptz,$4::uuid,$5::integer)) AND ($6::timestamptz IS NULL OR (h.created_at,h.record_id,h.revision)<($6::timestamptz,$7::uuid,$8::integer)) ORDER BY h.created_at DESC,h.record_id DESC,h.revision DESC LIMIT $2`,[owner,limit,anchor?.at??null,anchor?.id??null,anchor?.revision??null,after?.at??null,after?.id??null,after?.revision??null])).rows;
    return rows.map(row=>({entry:row.snapshot as StoredEntry,currentRevision:Number(row.current_revision),currentKind:row.current_kind as Kind,currentSourceId:row.current_source_id as string,key:windowKey(row.key_at,row.key_id,row.key_revision,mode)}));
   }
   const precise=select.replace('r.created_at,r.updated_at',`to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,to_char(r.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`);
   const rows=(await c.query(precise+' WHERE r.owner_id=$1 AND ($3::timestamptz IS NULL OR (r.created_at,r.id)<=($3::timestamptz,$4::uuid)) AND ($5::timestamptz IS NULL OR (r.created_at,r.id)<($5::timestamptz,$6::uuid)) ORDER BY r.created_at DESC,r.id DESC LIMIT $2',[owner,limit,anchor?.at??null,anchor?.id??null,after?.at??null,after?.id??null])).rows;
   return rows.map(row=>{const entry=decode(row);entry.createdAt=String(row.created_at);entry.updatedAt=String(row.updated_at);return{entry,currentRevision:entry.revision,currentKind:entry.kind,currentSourceId:entry.source.id,key:windowKey(entry.createdAt,entry.id,0,mode)};});
  },true);
 }
 async readCurrentSnapshot(owner:string):Promise<StoredEntry[]>{return this.scoped(owner,async c=>(await c.query(select+' WHERE r.owner_id=$1 ORDER BY r.id LIMIT 10001',[owner])).rows.map(decode),true);}
 async list(owner:string,kind:Kind):Promise<StoredEntry[]>{return this.scoped(owner,async c=>(await c.query(select+' WHERE r.owner_id=$1 AND r.kind=$2 ORDER BY r.created_at DESC,r.id',[owner,kind])).rows.map(decode));}
 async exportSnapshot(owner:string):Promise<{entries:StoredEntry[];history:StoredEntry[]}>{return this.scoped(owner,async client=>({entries:(await client.query(select+' WHERE r.owner_id=$1 ORDER BY r.id',[owner])).rows.map(decode),history:(await client.query('SELECT snapshot FROM lifeos_platform.platform_history WHERE owner_id=$1 ORDER BY record_id,revision',[owner])).rows.map(row=>row.snapshot as StoredEntry)}),true);}
 async history(owner:string,kind:Kind,id:string):Promise<StoredEntry[]>{return this.scoped(owner,async client=>(await client.query('SELECT h.snapshot FROM lifeos_platform.platform_history h JOIN lifeos_platform.platform_record r ON r.owner_id=h.owner_id AND r.id=h.record_id WHERE h.owner_id=$1 AND r.kind=$2 AND h.record_id=$3 ORDER BY h.revision DESC LIMIT 100',[owner,kind,id])).rows.map(row=>row.snapshot as StoredEntry));}
 async get(owner:string,kind:Kind,id:string):Promise<StoredEntry|null>{return this.scoped(owner,async c=>{const result=await c.query(select+' WHERE r.owner_id=$1 AND r.kind=$2 AND r.id=$3',[owner,kind,id]);return result.rows[0]?decode(result.rows[0]):null;});}
 async transaction<T>(owner:string,key:string,fn:(tx:Transaction)=>Promise<T>):Promise<T>{return this.scoped(owner,async client=>{
  if(this.personalOwnerGate)await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))',[ownerMaintenanceKey(owner)]);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([owner,key])]);
  const tx:Transaction={
   ...(this.businessFeatures?.organization?{lockAgentGrant:async(grant:AgentGrantBinding,requiredScopes:readonly AgentScope[])=>{
    if(grant.ownerId!==owner)return false;
    const result=await client.query('SELECT lifeos_agent.assert_business_grant($1,$2,$3,$4::text[]) AS allowed',[grant.grantId,grant.ownerId,grant.spaceId,requiredScopes]);
    return result.rows[0]?.allowed===true;
   }}:{}),
   ...(this.agentWriteFenceEnabled?{lockAgentTodoWriteGrant:async(grant:Readonly<{grantId:string;ownerId:string;spaceId:string}>)=>{
    if(grant.ownerId!==owner)return false;
    const result=await client.query('SELECT lifeos_agent.assert_todo_write_grant($1,$2,$3) AS allowed',[grant.grantId,grant.ownerId,grant.spaceId]);
    return result.rows[0]?.allowed===true;
   }}:{}),
   peek:async(kind,id)=>{const result=await client.query(select+' WHERE r.owner_id=$1 AND r.kind=$2 AND r.id=$3',[owner,kind,id]);return result.rows[0]?decode(result.rows[0]):null;},
   derivedTodo:async(id)=>{const result=await client.query(select+" WHERE r.owner_id=$1 AND r.kind='todo' AND r.inbox_id=$2",[owner,id]);return result.rows[0]?decode(result.rows[0]):null;},
   get:async(kind,id)=>{const result=await client.query(select+' WHERE r.owner_id=$1 AND r.kind=$2 AND r.id=$3 FOR UPDATE OF r',[owner,kind,id]);return result.rows[0]?decode(result.rows[0]):null;},
   refundsFor:async(id)=>(await client.query(select+" WHERE r.owner_id=$1 AND r.kind='finance' AND r.original_entry_id=$2",[owner,id])).rows.map(decode),
   receipt:async()=>{const result=await client.query('SELECT digest,response FROM lifeos_platform.platform_command WHERE owner_id=$1 AND command_key=$2',[owner,key]);return result.rows[0]?{digest:result.rows[0].digest,result:result.rows[0].response} as Receipt:null;},
   saveReceipt:async value=>{await client.query('INSERT INTO lifeos_platform.platform_command(owner_id,command_key,digest,response) VALUES($1,$2,$3,$4::jsonb)',[owner,key,value.digest,JSON.stringify(value.result)]);},
   write:async(entry,raw,create)=>{
    if(entry.ownerId!==owner)throw new PlatformError(404,'NOT_FOUND','没有可访问的记录。');
    const originalId='kind' in entry.draft?entry.draft.originalEntryId:null;
    if(create){
     await client.query('INSERT INTO lifeos_platform.platform_source(owner_id,id,system,external_id,version,as_of,original) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[owner,entry.source.id,entry.source.system,entry.source.externalId,entry.source.version,entry.source.asOf,JSON.stringify(entry.source.original)]);
     await client.query('INSERT INTO lifeos_platform.platform_record(owner_id,id,kind,source_id,draft,revision,created_at,updated_at,original_entry_id,inbox_id) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)',[owner,entry.id,entry.kind,entry.source.id,JSON.stringify(entry.draft),entry.revision,entry.createdAt,entry.updatedAt,originalId,entry.inboxId??null]);
    }else{
     const result=await client.query('UPDATE lifeos_platform.platform_record SET draft=$4::jsonb,revision=$5,updated_at=$6,original_entry_id=$7 WHERE owner_id=$1 AND id=$2 AND kind=$3 AND revision=$8',[owner,entry.id,entry.kind,JSON.stringify(entry.draft),entry.revision,entry.updatedAt,originalId,entry.revision-1]);
     if(result.rowCount!==1)throw new PlatformError(409,'REVISION_CONFLICT','记录已更新，请读取当前版本再核对。');
    }
    await client.query('INSERT INTO lifeos_platform.platform_history(owner_id,record_id,revision,raw,snapshot,created_at) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6)',[owner,entry.id,entry.revision,JSON.stringify(raw),JSON.stringify(entry),entry.updatedAt]);
   },
  };return fn(tx);
 });}
}
