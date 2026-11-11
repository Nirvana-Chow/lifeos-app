import {PlatformError,validateId} from '../platform/domain.ts';
import type {Transaction} from '../platform/contracts.ts';
import type {SqlClient} from '../platform/postgres.ts';
import type {ExecutionFence} from './contracts.ts';
export type {ExecutionFence} from './contracts.ts';
export type LeaseWriteBinding=ExecutionFence&{spaceId:string;requirementId:string;sourceId:string};
export async function assertExecutionWrite(tx:Transaction,binding:LeaseWriteBinding):Promise<void>{
 if(!tx.assertRequirementExecutionLease)throw new PlatformError(503,'EXECUTION_FENCE_UNAVAILABLE','执行租约检查尚未启用。');
 await tx.assertRequirementExecutionLease(binding);
}
/** Called only by the original repository on its existing owner transaction.
 * Row lock is held until commit; wall time is checked AFTER waiting for it. */
export async function assertPostgresExecutionLease(client:SqlClient,owner:string,b:LeaseWriteBinding){
 validateId(b.id);validateId(b.sourceId);
 if(!Number.isSafeInteger(b.fence)||b.fence<1||! /^[a-f0-9]{64}$/.test(b.workDigest))throw new PlatformError(400,'INVALID_EXECUTION_FENCE','执行租约无效。');
 await client.query("SELECT set_config('lifeos.requirement_event_space',$1,true)",[b.spaceId]);
 const result=await client.query(`SELECT lease_id::text,lease_fence,lease_holder,lease_grant_id,work_digest,source_id::text,dispatch_state,lease_expires_at FROM lifeos_platform.requirement_work WHERE owner_id=$1 AND space_id=$2 AND requirement_id=$3 FOR UPDATE`,[owner,b.spaceId,b.requirementId]);
 const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
 const row=result.rows[0];if(!row||row.lease_id!==b.id||Number(row.lease_fence)!==b.fence||row.lease_holder!==b.holderId||row.lease_grant_id!==b.grantId||row.work_digest!==b.workDigest||row.source_id!==b.sourceId||row.dispatch_state!=='running'||new Date(row.lease_expires_at as string).valueOf()<=new Date(now as string).valueOf())throw new PlatformError(409,'EXECUTION_LEASE_LOST','执行租约已失效。');
}
