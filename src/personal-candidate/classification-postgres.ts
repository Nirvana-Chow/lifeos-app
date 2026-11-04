import type {SqlClient,SqlPool} from '../platform/postgres.ts';
import type {ClassificationTransaction} from '../platform/contracts.ts';
import {PlatformError,validateId,validateIdempotencyKey} from '../platform/domain.ts';
import {decodePlan,decodeApproval,decodeReceipt,assertApprovalMatchesPlan,classificationNoOp,classificationCanonical,type ClassificationPlan,type ClassificationReceipt} from './classification-contracts.ts';
export const classificationUnavailable=()=>new PlatformError(503,'CLASSIFICATION_UNAVAILABLE','分类审核暂不可用。');
export const classificationCommandKey=(owner:string,space:string,key:string)=>JSON.stringify([owner,'todo-classification-v1',space,key]);
/** Separate readiness: the original schema2/four-table gate remains unchanged. */
export async function verifyClassificationClient(client:SqlClient):Promise<void>{
 try{
  const result=await client.query(`SELECT c.relname,c.relrowsecurity AS rls,c.relforcerowsecurity AS forced,
   c.relowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user) AS independent_owner,
   has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AS required,
   has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(current_user,c.oid,'UPDATE,REFERENCES') AS excessive,
   EXISTS(SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0) AS public_access,
   EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN ('lifeos_agent_key_manager','lifeos_agent_verifier','lifeos_agent_issuer','lifeos_platform_candidate_bootstrap') AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) AS other_access,
   (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid=c.oid) AS policies,
   (SELECT bool_and(p.polpermissive AND p.polroles=ARRAY[r.oid] AND
     CASE p.polcmd WHEN 'r' THEN p.polwithcheck IS NULL AND pg_get_expr(p.polqual,p.polrelid)=$1
      WHEN 'a' THEN p.polqual IS NULL AND pg_get_expr(p.polwithcheck,p.polrelid)=$1 ELSE false END)
    FROM pg_policy p WHERE p.polrelid=c.oid) AS policy_bound,
   (SELECT count(*)=2 AND bool_and(t.tgenabled='O' AND
     ((t.tgname='classification_binding' AND t.tgfoid=to_regprocedure('lifeos_platform.classification_insert_binding()')) OR
      (t.tgname='classification_immutable' AND t.tgfoid=to_regprocedure('lifeos_platform.classification_immutable()'))))
    FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS triggers,
   (SELECT count(*) FILTER(WHERE k.contype='f')=2 AND count(*) FILTER(WHERE k.contype='p')=1 AND count(*) FILTER(WHERE k.contype='u')=1
      AND count(*) FILTER(WHERE k.contype='c')=CASE c.relname WHEN 'platform_classification_approval' THEN 2 ELSE 3 END
    FROM pg_constraint k WHERE k.conrelid=c.oid) AS constraints,
   has_function_privilege(current_user,to_regprocedure('lifeos_agent.assert_business_grant(text,text,text,text[])'),'EXECUTE') AS authority,
   NOT EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conrelid=c.oid AND NOT k.convalidated) AS validated,
   current_user='lifeos_platform_candidate_runtime' AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreatedb AND NOT r.rolcreaterole
     AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS restricted
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.rolname=current_user
   WHERE n.nspname='lifeos_platform' AND c.relname IN ('platform_classification_plan','platform_classification_approval','platform_classification_command') AND c.relkind='r'`,["((owner_id = current_setting('lifeos.owner_id'::text, true)) AND (space_id = current_setting('lifeos.classification_space_id'::text, true)))"]);
  if(result.rows.length!==3||result.rows.some(row=>row.rls!==true||row.forced!==true||row.independent_owner!==true||row.required!==true||row.excessive!==false||row.public_access!==false||row.other_access!==false||row.policies!==2||row.policy_bound!==true||row.triggers!==true||row.constraints!==true||row.authority!==true||row.validated!==true||row.restricted!==true))throw classificationUnavailable();
 }catch{throw classificationUnavailable();}
}
export async function verifyClassificationPool(pool:SqlPool):Promise<void>{const client=await pool.connect();try{await verifyClassificationClient(client);}finally{client.release();}}
function missing():never{throw new PlatformError(404,'CLASSIFICATION_NOT_FOUND','分类计划不存在。');}
export function assertReceiptMatchesPlan(receipt:ClassificationReceipt,plan:ClassificationPlan):void{
 if(receipt.result.digest!==plan.preview.digest||receipt.planId!==plan.preview.planId||receipt.result.entries.length!==plan.preview.changes.length||classificationCanonical(receipt.result.unchangedIds)!==classificationCanonical(plan.preview.unchangedIds))throw new PlatformError(400,'INVALID_CLASSIFICATION','分类回执与计划不符。');
 for(const [i,change]of plan.preview.changes.entries()){
  const entry=receipt.result.entries[i],noop=classificationNoOp(change.before,change.after);
  if(entry.id!==change.todo.id||entry.sourceId!==change.todo.sourceId||entry.revision!==change.todo.expectedRevision+(noop?0:1)||classificationCanonical(entry.personal)!==classificationCanonical(noop?change.before:change.after))throw new PlatformError(400,'INVALID_CLASSIFICATION','分类回执与计划不符。');
 }
}
export function classificationQueries(client:SqlClient,owner:string,space:string,key:string):Pick<ClassificationTransaction,'getClassificationPlan'|'lockClassificationPlan'|'saveClassificationPlan'|'classificationApproval'|'saveClassificationApproval'|'classificationReceipt'|'classificationPlanCommitted'|'saveClassificationReceipt'>{
 validateIdempotencyKey(key);
 const getPlan=async(id:string)=>{const rows=(await client.query('SELECT plan FROM lifeos_platform.platform_classification_plan WHERE owner_id=$1 AND space_id=$2 AND plan_id=$3',[owner,space,validateId(id)])).rows;if(!rows[0])return null;const plan=decodePlan(rows[0].plan);if(plan.ownerId!==owner||plan.spaceId!==space||plan.preview.planId!==validateId(id))throw classificationUnavailable();return plan;};
 return{
  getClassificationPlan:getPlan,
  lockClassificationPlan:async id=>{await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([owner,'classification-plan-v1',space,validateId(id)])]);},
  saveClassificationPlan:async value=>{const p=decodePlan(value);if(p.ownerId!==owner||p.spaceId!==space)throw new PlatformError(403,'CLASSIFICATION_OWNER','分类计划空间不匹配。');await client.query('INSERT INTO lifeos_platform.platform_classification_plan(owner_id,space_id,plan_id,digest,proposal_revision,grant_id,plan) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[owner,space,p.preview.planId,p.preview.digest,p.proposalRevision,p.grantId,JSON.stringify(p)]);},
  classificationApproval:async id=>{const rows=(await client.query('SELECT approval FROM lifeos_platform.platform_classification_approval WHERE owner_id=$1 AND space_id=$2 AND plan_id=$3',[owner,space,validateId(id)])).rows;if(!rows[0])return null;const a=decodeApproval(rows[0].approval),p=await getPlan(id);if(!p)return missing();assertApprovalMatchesPlan(a,p);return a;},
  saveClassificationApproval:async value=>{const a=decodeApproval(value),p=await getPlan(a.planId);if(!p)return missing();assertApprovalMatchesPlan(a,p);await client.query('INSERT INTO lifeos_platform.platform_classification_approval(owner_id,space_id,plan_id,digest,proposal_revision,approval) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[owner,space,a.planId,a.digest,a.proposalRevision,JSON.stringify(a)]);},
  classificationReceipt:async()=>{const rows=(await client.query('SELECT receipt FROM lifeos_platform.platform_classification_command WHERE owner_id=$1 AND space_id=$2 AND command_key=$3',[owner,space,key])).rows;if(!rows[0])return null;const receipt=decodeReceipt(rows[0].receipt),plan=await getPlan(receipt.planId);if(!plan)return missing();assertReceiptMatchesPlan(receipt,plan);return receipt;},
  classificationPlanCommitted:async id=>(await client.query('SELECT 1 FROM lifeos_platform.platform_classification_command WHERE owner_id=$1 AND space_id=$2 AND plan_id=$3',[owner,space,validateId(id)])).rows.length>0,
  saveClassificationReceipt:async value=>{const receipt=decodeReceipt(value),plan=await getPlan(receipt.planId);if(!plan)return missing();assertReceiptMatchesPlan(receipt,plan);await client.query('INSERT INTO lifeos_platform.platform_classification_command(owner_id,space_id,command_key,plan_id,digest,proposal_revision,receipt) VALUES($1,$2,$3,$4,$5,1,$6::jsonb)',[owner,space,key,receipt.planId,receipt.result.digest,JSON.stringify(receipt)]);},
 };
}
