import type {SqlClient,SqlPool} from '../platform/postgres.ts';
import {PlatformError} from '../platform/domain.ts';
import type {EventActor,EventStore,EventTransaction,ExecutionLease,Work,WorkEvent} from './contracts.ts';
import {eventOperations} from './contracts.ts';
import {readExecutionCommand,saveExecutionCommand} from './command-postgres.ts';
const columns='requirement_id,source_id::text,record_revision,work_digest,dispatch_state,attempts,lease_fence,lease_id::text,lease_holder,lease_grant_id,lease_expires_at';
export function decodeWork(row:Record<string,unknown>):Work{
 const result:Work={requirementId:String(row.requirement_id),sourceId:String(row.source_id),revision:Number(row.record_revision),workDigest:String(row.work_digest),state:row.dispatch_state as Work['state'],attempts:Number(row.attempts),fence:Number(row.lease_fence),lease:null};
 if(row.lease_id)result.lease={id:String(row.lease_id),requirementId:result.requirementId,sourceId:result.sourceId,revision:result.revision,workDigest:result.workDigest,holderId:String(row.lease_holder),grantId:String(row.lease_grant_id),fence:result.fence,expiresAt:new Date(row.lease_expires_at as string).valueOf()};return result;
}
/** New tables/functions are unavailable until a separately reviewed migration.
 * No generic SQL escapes this adapter; existing API grant functions remain authority. */
export class PostgresRequirementEventStore implements EventStore{
 private pool:SqlPool;private enabled:boolean;
 constructor(pool:SqlPool,enabled=false){this.pool=pool;this.enabled=enabled;}
 async transaction<T>(actor:EventActor,operationId:string,run:(tx:EventTransaction)=>Promise<T>):Promise<T>{
  if(!this.enabled)throw new PlatformError(404,'REQUIREMENT_EVENTS_DISABLED','需求事件未启用。');
  if(![...Object.values(eventOperations),'getRequirement'].includes(operationId))throw new PlatformError(403,'ACCESS_DENIED','操作无效。');
  const client=await this.pool.connect(),owner=actor.ownerId,space=actor.spaceId;
  try{
   await client.query('BEGIN');await client.query("SELECT set_config('lifeos.owner_id',$1,true),set_config('lifeos.requirement_event_space',$2,true)",[owner,space]);
   const scopes=[eventOperations.stream,'getRequirement'].includes(operationId)?['requirements:read']:['requirements:read','requirements:write'];
   const permitted=await client.query(actor.businessDataPolicy?'SELECT lifeos_agent.assert_current_business_grant($1,$2,$3,$4::text[],$5,$6) AS allowed':'SELECT lifeos_agent.assert_business_grant($1,$2,$3,$4::text[]) AS allowed',[actor.grantId,owner,space,scopes,...(actor.businessDataPolicy?[actor.businessDataPolicy,operationId]:[])]);
   if(permitted.rows[0]?.allowed!==true)throw new PlatformError(403,'ACCESS_DENIED','授权已失效。');
   const values=[owner,space];
   const tx:EventTransaction={
    now:async()=>new Date((await client.query('SELECT clock_timestamp() AS now')).rows[0].now as string).valueOf(),
    get:async id=>{const r=await client.query('SELECT '+columns+' FROM lifeos_platform.requirement_work WHERE owner_id=$1 AND space_id=$2 AND requirement_id=$3 FOR UPDATE',[...values,id]);return r.rows[0]?decodeWork(r.rows[0]):null;},
    put:async item=>{const lease=item.lease;const r=await client.query(`UPDATE lifeos_platform.requirement_work SET record_revision=$4,work_digest=$5,dispatch_state=$6,attempts=$7,lease_fence=$8,lease_id=$9,lease_holder=$10,lease_grant_id=$11,lease_expires_at=$12 WHERE owner_id=$1 AND space_id=$2 AND requirement_id=$3 AND source_id=$13::uuid`,[...values,item.requirementId,item.revision,item.workDigest,item.state,item.attempts,item.fence,lease?.id??null,lease?.holderId??null,lease?.grantId??null,lease?new Date(lease.expiresAt).toISOString():null,item.sourceId]);if(r.rowCount!==1)throw new PlatformError(409,'REQUIREMENT_WORK_CHANGED','需求已变化。');},
    replay:async(after,limit)=>{
     // Bounds and retained page MUST use the same statement snapshot. A later
     // retention commit may remove rows between separate READ COMMITTED SELECTs.
     const bounds=(await client.query(`WITH visible_events AS MATERIALIZED (
       SELECT event_id,requirement_id,source_id,record_revision,work_digest,dispatch_state FROM lifeos_platform.requirement_event_outbox WHERE owner_id=$1 AND space_id=$2
      ), page AS (SELECT event_id::text AS cursor,requirement_id,source_id::text,record_revision,work_digest,dispatch_state FROM visible_events WHERE event_id>$3::bigint ORDER BY event_id LIMIT $4)
      SELECT (SELECT min(event_id)::text FROM visible_events) AS first,(SELECT max(event_id)::text FROM visible_events) AS last,
       COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY cursor::bigint) FROM page),'[]'::jsonb) AS events`,[...values,after,limit])).rows[0];
     const last=String(bounds.last??'0');if(BigInt(after)>BigInt(last))throw new PlatformError(409,'EVENT_CURSOR_AHEAD','事件游标超出当前范围。');
     const reset=after!=='0'&&bounds.first!==null&&BigInt(after)<BigInt(String(bounds.first))-1n;
     const rows=bounds.events as Record<string,unknown>[];
     const events=rows.map(row=>({cursor:String(row.cursor),requirementId:String(row.requirement_id),sourceId:String(row.source_id),revision:Number(row.record_revision),workDigest:String(row.work_digest),state:row.dispatch_state as WorkEvent['state']}));
     return{events,cursor:events.at(-1)?.cursor??last,reset};
    },
    ready:async limit=>(await client.query('SELECT '+columns+` FROM lifeos_platform.requirement_work WHERE owner_id=$1 AND space_id=$2 AND attempts<3 AND (dispatch_state='ready' OR dispatch_state='running' AND lease_expires_at<=clock_timestamp()) ORDER BY requirement_id LIMIT $3`,[...values,limit])).rows.map(decodeWork),
    claimReceipt:async requestId=>{const receipt=await readExecutionCommand(client,owner,{spaceId:space,grantId:actor.grantId,key:requestId});return receipt?{digest:receipt.digest,lease:receipt.response as ExecutionLease}:null;},
    saveClaimReceipt:async(requestId,receipt)=>saveExecutionCommand(client,owner,{spaceId:space,grantId:actor.grantId,key:requestId},receipt.digest,receipt.lease)
   };
   const result=await run(tx);await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
 }
}
