import {PostgresPlatformRepository,type SqlPool,type SqlClient} from '../platform/postgres.ts';
import {PostgresCalendarRepository,verifyCalendarPool} from '../calendar-candidate/postgres.ts';
import {PlatformError} from '../platform/domain.ts';
import {canonicalDigest,validateNativeIdentity,validateObservations} from './domain.ts';
import {createPostgresSyncCapture} from './capture.ts';
import {validateActiveDelivery,validateDeliveryCommandArchive,assertDeliveryBinding,assertDeliveryTransition} from './delivery-domain.ts';
import type {SyncRepository,SyncPrincipal,SyncTransaction,SyncLease,SyncMapping,SyncCommandReceipt,SyncOutboxItem,ActiveDelivery} from './store-contracts.ts';
function fail(code:string,status=409):never{throw new PlatformError(status,code,code);}
const token=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const keyValid=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/.test(v);
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const decimal=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,999})$/.test(v);
function cursor(v:unknown):string{if(!decimal(v))return fail('SYNC_CURSOR_INVALID',400);return v;}
function instant(v:string):number{
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v))return fail('SYNC_TIME_INVALID',400);
 const n=Date.parse(v);if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,19)!==v.slice(0,19))return fail('SYNC_TIME_INVALID',400);return n;
}
const iso=(v:unknown)=>new Date(v as string).toISOString();
function lease(row:Record<string,unknown>):SyncLease{return{ownerId:String(row.owner_id),spaceId:String(row.space_id),bridgeId:String(row.bridge_id),identityEpoch:String(row.identity_epoch),fence:String(row.fence),expiresAt:iso(row.expires_at),ackCursor:String(row.ack_cursor)};}
function mapping(row:Record<string,unknown>):SyncMapping{return{id:String(row.id),ownerId:String(row.owner_id),spaceId:String(row.space_id),bridgeId:String(row.bridge_id),kind:row.kind as 'todo'|'calendar',entityId:String(row.entity_id),sourceId:String(row.source_id),version:Number(row.version),businessRevision:Number(row.business_revision),nativeIdentity:validateNativeIdentity(row.native_identity),baseline:validateObservations(row.baseline),nativeHash:String(row.native_hash),status:row.status as SyncMapping['status'],evidence:row.evidence as SyncMapping['evidence']};}
/** Read-only readiness; never runs migrations or discovers runtime credentials. */
export async function verifyAppleSyncPool(pool:SqlPool):Promise<void>{
 await verifyCalendarPool(pool);
 const client=await pool.connect();try{
  const result=await client.query(`WITH expected(name,updates) AS (VALUES
   ('platform_sync_cursor',ARRAY['published']::text[]),
   ('platform_sync_lease',ARRAY['bridge_id','identity_epoch','fence','expires_at','ack_cursor','active_delivery']::text[]),
   ('platform_sync_outbox',ARRAY[]::text[]),
   ('platform_sync_mapping',ARRAY['version','business_revision','native_identity','baseline','native_hash','status','evidence']::text[]),
   ('platform_sync_command',ARRAY[]::text[]),('platform_sync_conflict',ARRAY[]::text[])),
  owned AS (SELECT c.oid,c.relrowsecurity,c.relforcerowsecurity,e.updates FROM expected e JOIN pg_namespace n ON n.nspname='lifeos_platform' JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=e.name)
  SELECT (SELECT version FROM lifeos_platform.platform_sync_meta) AS version,
   EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid='lifeos_platform.platform_sync_lease'::regclass AND a.attname='active_delivery' AND a.atttypid='jsonb'::regtype AND NOT a.attnotnull AND NOT a.attisdropped AND a.attgenerated='' AND NOT a.atthasdef) AND EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='lifeos_platform.platform_sync_lease'::regclass AND c.conname='sync_delivery_shape' AND c.contype='c' AND c.convalidated) AS delivery_column,
   EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='lifeos_platform.platform_sync_lease'::regclass AND c.conname='sync_delivery_shape' AND c.contype='c' AND c.convalidated
    AND ARRAY(SELECT a.attname::text FROM unnest(c.conkey) k(attnum) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum AND NOT a.attisdropped ORDER BY a.attname)=ARRAY['active_delivery','bridge_id','identity_epoch','owner_id','space_id']::text[]
    AND encode(sha256(convert_to(c.conbin::text||':'||c.conkey::text,'UTF8')),'hex')=(SELECT delivery_shape_digest FROM lifeos_platform.platform_sync_meta)) AS delivery_shape,
   (SELECT count(*)::int FROM owned WHERE relrowsecurity) AS rls_tables,
   (SELECT count(*)::int FROM owned WHERE relforcerowsecurity) AS forced_tables,
   (SELECT count(*)=6 AND bool_and((SELECT count(*)=1 AND bool_and(p.polcmd='*' AND p.polpermissive AND p.polroles=ARRAY[0::oid] AND pg_get_expr(p.polqual,p.polrelid)='(owner_id = current_setting(''lifeos.owner_id''::text, true))' AND pg_get_expr(p.polwithcheck,p.polrelid)='(owner_id = current_setting(''lifeos.owner_id''::text, true))') FROM pg_policy p WHERE p.polrelid=o.oid)) FROM owned o) AS owner_policies,
   has_table_privilege(current_user,'lifeos_platform.platform_sync_meta','SELECT') AND
   (SELECT count(*)=6 AND bool_and(has_table_privilege(current_user,oid,'SELECT') AND has_table_privilege(current_user,oid,'INSERT') AND NOT EXISTS(SELECT 1 FROM unnest(updates) a(name) WHERE NOT has_column_privilege(current_user,oid,a.name,'UPDATE'))) FROM owned) AS required,
   EXISTS(SELECT 1 FROM owned o WHERE has_table_privilege(current_user,o.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=o.oid AND a.attnum>0 AND NOT a.attisdropped AND (has_column_privilege(current_user,o.oid,a.attnum,'REFERENCES') OR (NOT a.attname=ANY(o.updates) AND has_column_privilege(current_user,o.oid,a.attnum,'UPDATE')))))
   OR has_table_privilege(current_user,'lifeos_platform.platform_sync_meta','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(current_user,'lifeos_platform.platform_sync_meta','INSERT,UPDATE,REFERENCES') AS excessive,
   EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lifeos_platform' AND c.relname IN ('platform_sync_meta','platform_sync_cursor','platform_sync_lease','platform_sync_outbox','platform_sync_mapping','platform_sync_command','platform_sync_conflict') AND (has_table_privilege('lifeos_platform_candidate_bootstrap',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege('lifeos_platform_candidate_bootstrap',c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) AS bootstrap_excessive`);
  const m=result.rows[0];if(result.rows.length!==1||m.version!==1||m.rls_tables!==6||m.forced_tables!==6||m.owner_policies!==true||m.required!==true||m.excessive!==false||m.bootstrap_excessive!==false||m.delivery_column!==true||m.delivery_shape!==true)fail('SYNC_RESTRICTED_EXTENSION_REQUIRED',503);
 }finally{client.release();}
}
export class PostgresSyncRepository implements SyncRepository {
 private readonly scope:{ownerId:string;spaceId:string};private readonly pool:SqlPool;
 constructor(pool:SqlPool,scope:{ownerId:string;spaceId:string}){if(!/^[A-Za-z0-9_-]{6,80}$/.test(scope.ownerId)||!token(scope.spaceId))fail('SYNC_SCOPE_INVALID',400);this.pool=pool;this.scope={ownerId:scope.ownerId,spaceId:scope.spaceId};}
 async transaction<T>(input:SyncPrincipal,key:string,fn:(tx:SyncTransaction)=>Promise<T>):Promise<T>{
  if(!input||input.ownerId!==this.scope.ownerId||input.spaceId!==this.scope.spaceId||!token(input.bridgeId)||!token(input.identityEpoch)||!Array.isArray(input.scopes)||!input.scopes.includes('sync:read')||input.scopes.some(s=>s!=='sync:read'&&s!=='sync:write')||!keyValid(key))fail('SYNC_PRINCIPAL_INVALID',403);
  const p:SyncPrincipal={...input,scopes:[...input.scopes]};const owner=p.ownerId,space=p.spaceId,bridge=p.bridgeId,epoch=p.identityEpoch;
  const client=await this.pool.connect(),capture=createPostgresSyncCapture(this.scope);let open=true,validatedLease:SyncLease|null=null,deliveryFailure:unknown=null;
  const active=()=>{if(!open)fail('SYNC_TRANSACTION_CLOSED');};
  const write=()=>{active();if(!p.scopes.includes('sync:write'))fail('SYNC_SCOPE_REQUIRED',403);};
  const leasedWrite=()=>{write();if(!validatedLease)fail('SYNC_LEASE_REQUIRED');};
  const loadLeaseRow=async()=>{active();const row=(await client.query('SELECT owner_id,space_id,bridge_id,identity_epoch,fence::text,expires_at,ack_cursor::text,active_delivery FROM lifeos_platform.platform_sync_lease WHERE owner_id=$1 AND space_id=$2 FOR UPDATE',[owner,space])).rows[0];if(!row)return null;if(row.owner_id!==owner||row.space_id!==space)fail('SYNC_LEASE_STALE');return row;};
  const loadLease=async()=>{const row=await loadLeaseRow();return row?lease(row):null;};
  const decodeDelivery=(row:Record<string,unknown>|null):ActiveDelivery|null=>{if(!row)return null;if(row.bridge_id!==bridge||row.identity_epoch!==epoch)fail('SYNC_LEASE_HANDOVER_REQUIRED');if(row.active_delivery===null||row.active_delivery===undefined)return null;const value=validateActiveDelivery(row.active_delivery);assertDeliveryBinding(value,p);return value;};
  const readDelivery=async()=>decodeDelivery(await loadLeaseRow());
  const requireLease=async(fence:string,now:string)=>{active();const n=instant(now);cursor(fence);const value=await loadLease();if(!value||value.bridgeId!==bridge||value.identityEpoch!==epoch||value.fence!==fence||Date.parse(value.expiresAt)<=n)fail('SYNC_LEASE_STALE');validatedLease=value;return value;};
  const getMapping=async(id:string)=>{active();if(!uuid(id))fail('SYNC_MAPPING_INVALID',400);const row=(await client.query('SELECT * FROM lifeos_platform.platform_sync_mapping WHERE owner_id=$1 AND space_id=$2 AND bridge_id=$3 AND id=$4 FOR UPDATE',[owner,space,bridge,id])).rows[0];if(!row)return null;const value=mapping(row);if(value.ownerId!==owner||value.spaceId!==space||value.bridgeId!==bridge)fail('SYNC_MAPPING_BINDING');return value;};
  const receipt=async():Promise<SyncCommandReceipt|null>=>{active();const row=(await client.query('SELECT digest,result FROM lifeos_platform.platform_sync_command WHERE owner_id=$1 AND space_id=$2 AND bridge_id=$3 AND identity_epoch=$4 AND command_key=$5',[owner,space,bridge,epoch,key])).rows[0];return row?{digest:String(row.digest),result:row.result as SyncCommandReceipt['result']}:null;};
  // Keep the original services as the sole business writer, with mutation authorization checked here.
  const bound={client,owner};
  const guard=<R extends object>(repo:R):R=>new Proxy(repo,{get(target,property,receiver){const method=Reflect.get(target,property,receiver);if(typeof method!=='function')return method;return async(...args:unknown[])=>{active();if(property==='transaction')leasedWrite();return Reflect.apply(method,target,args);};}});
  const tx:SyncTransaction={
   platform:guard(new PostgresPlatformRepository(this.pool,true,capture,bound)),calendar:guard(new PostgresCalendarRepository(this.pool,capture,bound)),
   claimLease:async(now,ttlSeconds)=>{
    write();const time=instant(now);if(!Number.isInteger(ttlSeconds)||ttlSeconds<5||ttlSeconds>300)fail('SYNC_LEASE_TTL_INVALID',400);
    const current=await loadLease(),expiresAt=new Date(time+ttlSeconds*1000).toISOString();let row:Record<string,unknown>|undefined;
    if(!current)row=(await client.query('INSERT INTO lifeos_platform.platform_sync_lease(owner_id,space_id,bridge_id,identity_epoch,fence,expires_at,ack_cursor) VALUES($1,$2,$3,$4,1,$5,0) RETURNING owner_id,space_id,bridge_id,identity_epoch,fence::text,expires_at,ack_cursor::text',[owner,space,bridge,epoch,expiresAt])).rows[0];
    else{
     const live=Date.parse(current.expiresAt)>time;if(current.bridgeId!==bridge||current.identityEpoch!==epoch)fail('SYNC_LEASE_HANDOVER_REQUIRED');
     const fence=live?current.fence:String(BigInt(cursor(current.fence))+1n);
     row=(await client.query('UPDATE lifeos_platform.platform_sync_lease SET bridge_id=$3,identity_epoch=$4,fence=$5::numeric,expires_at=$6 WHERE owner_id=$1 AND space_id=$2 RETURNING owner_id,space_id,bridge_id,identity_epoch,fence::text,expires_at,ack_cursor::text',[owner,space,bridge,epoch,fence,expiresAt])).rows[0];
    }
    if(!row)fail('SYNC_LEASE_UNAVAILABLE');validatedLease=lease(row);return validatedLease;
   },requireLease,
   readDelivery,
   saveDelivery:async(expectedVersion,next)=>{
    // Validation, archive checks and CAS share one failure boundary: no caught
    // save error may let the outer transaction commit an orphan archive.
    try{
     leasedWrite();const value=validateActiveDelivery(next);assertDeliveryBinding(value,p);
     const command=await receipt();if(!command)fail('SYNC_DELIVERY_ARCHIVE_REQUIRED');
     try{const archive=validateDeliveryCommandArchive(command.result);if(canonicalDigest(archive.delivery)!==canonicalDigest(value))fail('SYNC_DELIVERY_ARCHIVE_REQUIRED');}catch{fail('SYNC_DELIVERY_ARCHIVE_REQUIRED');}
     const row=await loadLeaseRow();if(!row||String(row.fence)!==validatedLease!.fence)fail('SYNC_LEASE_STALE');
     const previous=decodeDelivery(row);assertDeliveryTransition(previous,expectedVersion,value);
     const result=await client.query('UPDATE lifeos_platform.platform_sync_lease SET active_delivery=$3::jsonb WHERE owner_id=$1 AND space_id=$2 AND bridge_id=$4 AND identity_epoch=$5 AND fence=$6::numeric AND active_delivery IS NOT DISTINCT FROM $7::jsonb',[owner,space,JSON.stringify(value),bridge,epoch,validatedLease!.fence,previous===null?null:JSON.stringify(previous)]);
     if(result.rowCount!==1)fail('SYNC_DELIVERY_CAS');
    }catch(error){deliveryFailure=error;throw error;}
   },
   pull:async(after,limit)=>{active();cursor(after);if(!Number.isInteger(limit)||limit<1||limit>100)fail('SYNC_PULL_INVALID',400);if(!validatedLease)fail('SYNC_LEASE_REQUIRED');const rows=(await client.query('SELECT o.cursor::text,o.kind,o.entity_id::text,o.source_id::text,o.revision,o.command_key,o.snapshot FROM lifeos_platform.platform_sync_outbox o WHERE o.owner_id=$1 AND o.space_id=$2 AND o.cursor>$3::numeric ORDER BY o.cursor ASC LIMIT $4',[owner,space,after,limit])).rows;return rows.map(row=>({cursor:String(row.cursor),kind:row.kind as SyncOutboxItem['kind'],entityId:String(row.entity_id),sourceId:String(row.source_id),revision:Number(row.revision),commandKey:String(row.command_key),snapshot:row.snapshot}));},
   receipt,
   saveReceipt:async value=>{leasedWrite();if(!/^[0-9a-f]{64}$/.test(value.digest))fail('SYNC_RECEIPT_INVALID',400);const digest=canonicalDigest(value.result),existing=await receipt();if(existing){if(existing.digest!==value.digest||canonicalDigest(existing.result)!==digest)fail('SYNC_COMMAND_REPLAY_MISMATCH');return;}await client.query('INSERT INTO lifeos_platform.platform_sync_command(owner_id,space_id,bridge_id,identity_epoch,command_key,digest,result) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[owner,space,bridge,epoch,key,value.digest,JSON.stringify(value.result)]);},
   getMapping,
   findMapping:async(kind,entityId)=>{active();if(!['todo','calendar'].includes(kind)||!uuid(entityId))fail('SYNC_MAPPING_INVALID',400);const row=(await client.query('SELECT * FROM lifeos_platform.platform_sync_mapping WHERE owner_id=$1 AND space_id=$2 AND bridge_id=$3 AND kind=$4 AND entity_id=$5 FOR UPDATE',[owner,space,bridge,kind,entityId])).rows[0];if(!row)return null;const value=mapping(row);if(value.ownerId!==owner||value.spaceId!==space||value.bridgeId!==bridge||value.kind!==kind||value.entityId!==entityId)fail('SYNC_MAPPING_BINDING');return value;},
   saveMapping:async(value,expectedVersion)=>{
    leasedWrite();canonicalDigest(value);
    if(value.ownerId!==owner||value.spaceId!==space||value.bridgeId!==bridge||!uuid(value.id)||!uuid(value.entityId)||!uuid(value.sourceId)||!['todo','calendar'].includes(value.kind)||!Number.isInteger(value.version)||value.version<1||value.version>2147483647||!Number.isInteger(value.businessRevision)||value.businessRevision<1||value.businessRevision>2147483647||!['active','conflict','missing'].includes(value.status)||! /^[0-9a-f]{64}$/.test(value.nativeHash))fail('SYNC_MAPPING_BINDING');
    validateNativeIdentity(value.nativeIdentity);validateObservations(value.baseline);
    if(expectedVersion!==null&&(!Number.isInteger(expectedVersion)||expectedVersion<1||expectedVersion>=2147483647))fail('SYNC_MAPPING_CAS');
    if(value.version!==(expectedVersion===null?1:expectedVersion+1))fail('SYNC_MAPPING_CAS');
    const current=await getMapping(value.id);if(expectedVersion===null?current!==null:current?.version!==expectedVersion)fail('SYNC_MAPPING_CAS');
    if(current&&(current.kind!==value.kind||current.entityId!==value.entityId||current.sourceId!==value.sourceId||current.bridgeId!==value.bridgeId||value.businessRevision<current.businessRevision))fail('SYNC_MAPPING_BINDING');
    const sql=value.kind==='todo'?"SELECT source_id::text,revision FROM lifeos_platform.platform_record WHERE owner_id=$1 AND id=$2 AND kind='todo' FOR KEY SHARE":"SELECT source_id::text,revision FROM lifeos_platform.platform_calendar_event WHERE owner_id=$1 AND id=$2 FOR KEY SHARE";
    const entity=(await client.query(sql,[owner,value.entityId])).rows[0];if(!entity||entity.source_id!==value.sourceId||Number(entity.revision)<value.businessRevision)fail('SYNC_MAPPING_BINDING');
    const values=[owner,space,bridge,value.id,value.kind,value.entityId,value.sourceId,value.version,value.businessRevision,JSON.stringify(value.nativeIdentity),JSON.stringify(value.baseline),value.nativeHash,value.status,JSON.stringify(value.evidence)];
    if(expectedVersion===null)await client.query('INSERT INTO lifeos_platform.platform_sync_mapping(owner_id,space_id,bridge_id,id,kind,entity_id,source_id,version,business_revision,native_identity,baseline,native_hash,status,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14::jsonb)',values);
    else {const result=await client.query('UPDATE lifeos_platform.platform_sync_mapping SET version=$8,business_revision=$9,native_identity=$10::jsonb,baseline=$11::jsonb,native_hash=$12,status=$13,evidence=$14::jsonb WHERE owner_id=$1 AND space_id=$2 AND bridge_id=$3 AND id=$4 AND kind=$5 AND entity_id=$6 AND source_id=$7 AND version=$15',[...values,expectedVersion]);if(result.rowCount!==1)fail('SYNC_MAPPING_CAS');}
   },
   saveConflict:async value=>{leasedWrite();canonicalDigest(value);if(!uuid(value.id)||!token(value.kind))fail('SYNC_CONFLICT_INVALID',400);instant(value.createdAt);if(value.mappingId!==null&&!await getMapping(value.mappingId))fail('SYNC_MAPPING_BINDING');await client.query('INSERT INTO lifeos_platform.platform_sync_conflict(owner_id,space_id,bridge_id,id,mapping_id,kind,evidence,created_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',[owner,space,bridge,value.id,value.mappingId,value.kind,JSON.stringify(value.evidence),value.createdAt]);},
   advanceCursor:async(fence,next,now)=>{
    write();cursor(next);const current=await requireLease(fence,now),previous=BigInt(cursor(current.ackCursor));if(BigInt(next)<previous)fail('SYNC_ACK_REWIND');
    const published=(await client.query('SELECT published::text FROM lifeos_platform.platform_sync_cursor WHERE owner_id=$1 AND space_id=$2 FOR UPDATE',[owner,space])).rows[0];if(!published||BigInt(next)>BigInt(cursor(published.published)))fail('SYNC_ACK_UNPUBLISHED');if(next===current.ackCursor)return current;
    const row=(await client.query('SELECT o.cursor::text FROM lifeos_platform.platform_sync_outbox o WHERE o.owner_id=$1 AND o.space_id=$2 AND o.cursor>$3::numeric ORDER BY o.cursor ASC LIMIT 1',[owner,space,current.ackCursor])).rows[0];if(!row||String(row.cursor)!==next)fail('SYNC_ACK_NOT_NEXT');
    const updated=(await client.query('UPDATE lifeos_platform.platform_sync_lease SET ack_cursor=$3::numeric WHERE owner_id=$1 AND space_id=$2 AND bridge_id=$4 AND identity_epoch=$5 AND fence=$6::numeric RETURNING owner_id,space_id,bridge_id,identity_epoch,fence::text,expires_at,ack_cursor::text',[owner,space,next,bridge,epoch,fence])).rows[0];if(!updated)fail('SYNC_LEASE_STALE');validatedLease=lease(updated);return validatedLease;
   },
  };
  try{
   await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');await client.query("SELECT set_config('lifeos.owner_id',$1,true)",[owner]);
   await capture.begin(client,owner);
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['apple-sync-command',owner,space,bridge,epoch,key])]);
   const result=await fn(tx);if(deliveryFailure)throw deliveryFailure;open=false;await client.query('COMMIT');return result;
  }catch(error){open=false;await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
 }
}
