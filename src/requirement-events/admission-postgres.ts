import {PlatformError} from '../platform/domain.ts';
import type {SqlClient} from '../platform/postgres.ts';
import {admissionTransition,type ExecutionProjectionBinding,type ExecutionAdmissionBinding,type AdmissionResult} from './admission.ts';
import {decodeWork} from './postgres.ts';
import {saveExecutionCommand} from './command-postgres.ts';
import type {Work} from './contracts.ts';
/** Same expression as the reviewed 0020 trigger; PostgreSQL jsonb text, not a JS
 * approximation, defines the original record's generation. */
export const requirementWorkDigestSQL="encode(sha256(convert_to(jsonb_build_array(r.source_id::text,r.draft->>'title',r.draft->>'text',r.draft->'requirement'->>'phaseId',r.draft->'requirement'->>'priority',r.draft->'requirement'->'plannedStartOn',r.draft->'requirement'->'plannedEndOn')::text,'UTF8')),'hex')";
export async function projectPostgresExecution(client:SqlClient,owner:string,b:ExecutionProjectionBinding){
 await client.query("SELECT set_config('lifeos.requirement_event_space',$1,true)",[b.spaceId]);
 const row=(await client.query(`SELECT ${requirementWorkDigestSQL} AS original_digest,w.*,
  w.source_id::text AS source_id,clock_timestamp() AS observed_at
  FROM lifeos_platform.platform_record r JOIN lifeos_platform.platform_source s ON s.owner_id=r.owner_id AND s.id=r.source_id
  LEFT JOIN lifeos_platform.requirement_work w ON w.owner_id=r.owner_id AND w.space_id=$2 AND w.requirement_id=$3
  WHERE r.owner_id=$1 AND r.kind='inbox' AND r.source_id=$4::uuid AND r.revision=$5
   AND s.original->>'marker'='personal-requirement-v2' AND s.original->>'spaceId'=$2
   AND r.draft->'requirement'->>'id'=$3`,[owner,b.spaceId,b.requirementId,b.sourceId,b.revision])).rows;
 if(row.length!==1||typeof row[0].original_digest!=='string')throw new PlatformError(409,'REQUIREMENT_WORK_CHANGED','需求原记录已变化。');
 const item=row[0],work:Work=item.requirement_id?decodeWork(item):{requirementId:b.requirementId,sourceId:b.sourceId,revision:b.revision,workDigest:item.original_digest as string,state:'candidate',attempts:0,fence:0,lease:null};
 if(work.sourceId!==b.sourceId||work.revision!==b.revision||work.workDigest!==item.original_digest)throw new PlatformError(409,'REQUIREMENT_WORK_CHANGED','执行投影与需求原记录不一致。');
 return{...work,leaseActive:work.state==='running'&&!!work.lease&&work.lease.expiresAt>new Date(item.observed_at as string).valueOf()};
}
export async function admitPostgresExecution(client:SqlClient,owner:string,b:ExecutionAdmissionBinding):Promise<AdmissionResult>{
 await client.query("SELECT set_config('lifeos.requirement_event_space',$1,true)",[b.spaceId]);
 // Identical jsonb lock identity to the trigger; held through the original
 // transaction commit so a reader's cursor cannot skip an uncommitted event.
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended(jsonb_build_array('requirement-events-v1',$1::text,$2::text)::text,0))",[owner,b.spaceId]);
 const row=(await client.query('SELECT *,source_id::text AS source_id FROM lifeos_platform.requirement_work WHERE owner_id=$1 AND space_id=$2 AND requirement_id=$3 FOR UPDATE',[owner,b.spaceId,b.projection.requirementId])).rows[0];
 const changed=admissionTransition(row?decodeWork(row):null,b.projection),w=changed.work;
 if(changed.changed){
  if(row)await client.query("UPDATE lifeos_platform.requirement_work SET dispatch_state='ready' WHERE owner_id=$1 AND space_id=$2 AND requirement_id=$3",[owner,b.spaceId,w.requirementId]);
  else await client.query("INSERT INTO lifeos_platform.requirement_work(owner_id,space_id,requirement_id,source_id,record_revision,work_digest,dispatch_state,attempts,lease_fence) VALUES($1,$2,$3,$4::uuid,$5,$6,'ready',$7,$8)",[owner,b.spaceId,w.requirementId,w.sourceId,w.revision,w.workDigest,w.attempts,w.fence]);
  await client.query("INSERT INTO lifeos_platform.requirement_event_outbox(owner_id,space_id,requirement_id,source_id,record_revision,work_digest,dispatch_state) VALUES($1,$2,$3,$4::uuid,$5,$6,'ready')",[owner,b.spaceId,w.requirementId,w.sourceId,w.revision,w.workDigest]);
  await client.query('DELETE FROM lifeos_platform.requirement_event_outbox WHERE owner_id=$1 AND space_id=$2 AND event_id<(SELECT event_id FROM lifeos_platform.requirement_event_outbox WHERE owner_id=$1 AND space_id=$2 ORDER BY event_id DESC OFFSET 999 LIMIT 1)',[owner,b.spaceId]);
  await client.query("SELECT pg_notify('lifeos_requirement_events','')");
 }
 const result={admission:w,duplicate:false};await saveExecutionCommand(client,owner,b,b.digest,{kind:'admission-v1',result});return result;
}
