import type {SqlClient} from '../platform/postgres.ts';
import {ownerMaintenanceKey} from '../deployment-candidate/owner-maintenance-key.ts';
export interface SyncCapture {
 begin(client:SqlClient,owner:string):Promise<void>;
 append(client:SqlClient,owner:string,mutation:{kind:'todo'|'calendar';entityId:string;sourceId:string;revision:number;commandKey:string;snapshot:unknown}):Promise<void>;
}
/** Optional transactional outbox hook. It never mutates a business record. */
export function createPostgresSyncCapture(scope:{ownerId:string;spaceId:string}):SyncCapture {
 if(!scope.ownerId||!scope.spaceId||scope.spaceId.length>128)throw Error('SYNC_SCOPE_INVALID');
 const {ownerId,spaceId}=scope;
 const check=(owner:string)=>{if(owner!==ownerId)throw Error('SYNC_OWNER_MISMATCH');};
 return {
  async begin(client,owner){
   check(owner);
   // Identical order for website capture and bridge outer transactions.
   await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))',[ownerMaintenanceKey(owner)]);
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['apple-sync',owner,spaceId])]);
   await client.query('INSERT INTO lifeos_platform.platform_sync_cursor(owner_id,space_id,published) VALUES($1,$2,0) ON CONFLICT(owner_id,space_id) DO NOTHING',[owner,spaceId]);
   await client.query('SELECT published::text FROM lifeos_platform.platform_sync_cursor WHERE owner_id=$1 AND space_id=$2 FOR UPDATE',[owner,spaceId]);
  },
  async append(client,owner,m){
   check(owner);
   const s=m.snapshot as {ownerId?:unknown;id?:unknown;revision?:unknown;source?:{id?:unknown}}|null;
   if(!['todo','calendar'].includes(m.kind)||!Number.isInteger(m.revision)||m.revision<1||m.revision>2147483647||!s||s.ownerId!==owner||s.id!==m.entityId||s.revision!==m.revision||s.source?.id!==m.sourceId||! /^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/.test(m.commandKey))throw Error('SYNC_CAPTURE_INVALID');
   const result=await client.query('UPDATE lifeos_platform.platform_sync_cursor SET published=published+1 WHERE owner_id=$1 AND space_id=$2 RETURNING published::text',[owner,spaceId]);
   if(result.rowCount!==1||!result.rows[0]?.published)throw Error('SYNC_CURSOR_UNAVAILABLE');
   await client.query('INSERT INTO lifeos_platform.platform_sync_outbox(owner_id,space_id,cursor,kind,entity_id,source_id,revision,command_key,snapshot) VALUES($1,$2,$3::numeric,$4,$5,$6,$7,$8,$9::jsonb)',[owner,spaceId,result.rows[0].published,m.kind,m.entityId,m.sourceId,m.revision,m.commandKey,JSON.stringify(m.snapshot)]);
  },
 };
}
