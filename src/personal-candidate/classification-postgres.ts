import type {SqlClient,SqlPool} from '../platform/postgres.ts';
import type {ClassificationTransaction} from '../platform/contracts.ts';
import {PlatformError,validateId,validateIdempotencyKey} from '../platform/domain.ts';
import {decodePlan,decodeApproval,decodeReceipt,assertApprovalMatchesPlan,classificationNoOp,classificationCanonical,type ClassificationPlan,type ClassificationReceipt} from './classification-contracts.ts';
import {assertClassificationOAuthProducer} from './classification-oauth.ts';
export const classificationUnavailable=()=>new PlatformError(503,'CLASSIFICATION_UNAVAILABLE','分类审核暂不可用。');
export const classificationCommandKey=(owner:string,space:string,key:string)=>JSON.stringify([owner,'todo-classification-v1',space,key]);
type ConstraintShape={kind:string;columns:string[];target:string|null;references:string[];expression:string|null;functionIds:string[]};
const planKey=['owner_id','space_id','plan_id'];
const bindingKey=[...planKey,'digest','proposal_revision'];
const ownerForeignKey={kind:'f',columns:['owner_id'],target:'lifeos_platform.platform_user',references:['id']};
const checks:Record<string,readonly string[]>={
 platform_classification_plan:[
  "(proposal_revision = 1)",
  "classification_valid(plan, 'plan'::text)",
  "(((plan ->> 'ownerId'::text) = owner_id) AND ((plan ->> 'spaceId'::text) = space_id) AND ((plan #>> '{preview,planId}'::text[]) = (plan_id)::text) AND ((plan #>> '{preview,digest}'::text[]) = digest) AND (((plan ->> 'proposalRevision'::text))::integer = proposal_revision) AND (NOT ((plan ->> 'grantId'::text) IS DISTINCT FROM grant_id)))",
 ],
 platform_classification_approval:[
  "classification_valid(approval, 'approval'::text)",
  "(((approval ->> 'planId'::text) = (plan_id)::text) AND ((approval ->> 'digest'::text) = digest) AND (((approval ->> 'proposalRevision'::text))::integer = proposal_revision))",
 ],
 platform_classification_command:[
  "(command_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$'::text)",
  "classification_valid(receipt, 'receipt'::text)",
  "(((receipt ->> 'planId'::text) = (plan_id)::text) AND ((receipt #>> '{result,digest}'::text[]) = digest) AND (proposal_revision = 1))",
 ],
};
/** pg_get_expr deparses parsed CHECK trees, discarding source layout/parentheses.
 * Do not strip literals or compare DDL hashes/names. Function OIDs are separately
 * bound so search_path cannot substitute a same-named validation function. */
function qualifiedConstraints(table:string,value:unknown,validatorId:unknown):boolean{
 if(!Array.isArray(value)||!checks[table]||typeof validatorId!=='string')return false;
 const shapes=value as ConstraintShape[];
 const expected=[
  {kind:'p',columns:table==='platform_classification_command'?['owner_id','space_id','command_key']:planKey},
  {kind:'u',columns:table==='platform_classification_command'?planKey:bindingKey},
  ownerForeignKey,
  table==='platform_classification_plan'?{kind:'f',columns:['grant_id'],target:'lifeos_agent.apikey',references:['id']}:
   {kind:'f',columns:bindingKey,target:'lifeos_platform.platform_classification_'+(table==='platform_classification_approval'?'plan':'approval'),references:bindingKey},
 ];
 const sorted=(v:readonly string[])=>JSON.stringify([...v].sort());
 if(shapes.length!==expected.length+checks[table].length)return false;
 for(const required of expected){
  if(shapes.filter(actual=>{
   if(actual.kind!==required.kind)return false;
   if(required.kind!=='f')return sorted(actual.columns)===sorted(required.columns);
   if(!('references'in required)||actual.target!==required.target||actual.columns.length!==actual.references.length)return false;
   const pairs=(columns:readonly string[],references:readonly string[])=>sorted(columns.map((column,i)=>JSON.stringify([column,references[i]])));
   return pairs(actual.columns,actual.references)===pairs(required.columns,required.references);
  }).length!==1)return false;
 }
 for(const expression of checks[table]){
  const expectedFunctions=expression.startsWith('classification_valid(')?[validatorId]:[];
  if(shapes.filter(actual=>actual.kind==='c'&&
   (actual.expression===expression||actual.expression==='lifeos_platform.'+expression)&&
   sorted(actual.functionIds)===sorted(expectedFunctions)).length!==1)return false;
 }
 return true;
}
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
   (SELECT count(*)=2 AND bool_and(t.tgenabled='O' AND t.tgattr::text='' AND t.tgqual IS NULL
      AND t.tgnargs=0 AND octet_length(t.tgargs)=0 AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL AND
     ((t.tgfoid=to_regprocedure('lifeos_platform.classification_insert_binding()') AND t.tgtype=(1|2|4)) OR
      (t.tgfoid=to_regprocedure('lifeos_platform.classification_immutable()') AND t.tgtype=(1|2|8|16))))
      AND count(*) FILTER(WHERE t.tgfoid=to_regprocedure('lifeos_platform.classification_insert_binding()'))=1
      AND count(*) FILTER(WHERE t.tgfoid=to_regprocedure('lifeos_platform.classification_immutable()'))=1
    FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS triggers,
   (SELECT bool_and(k.convalidated AND NOT k.condeferrable AND NOT k.condeferred AND k.conislocal AND k.coninhcount=0
      AND CASE WHEN k.contype='f' THEN k.confmatchtype='s' AND k.confupdtype='a' AND k.confdeltype='a' AND k.confdelsetcols IS NULL
       WHEN k.contype IN ('p','u') THEN EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid=k.conindid AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate AND i.indpred IS NULL AND i.indexprs IS NULL)
       ELSE k.contype='c' END)
    FROM pg_constraint k WHERE k.conrelid=c.oid) AS constraint_options,
   (SELECT jsonb_agg(jsonb_build_object('kind',k.contype,
      'columns',ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY x(num,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=x.num ORDER BY x.ord),
      'target',CASE WHEN k.contype='f' THEN (SELECT n.nspname||'.'||f.relname FROM pg_class f JOIN pg_namespace n ON n.oid=f.relnamespace WHERE f.oid=k.confrelid) END,
      'references',ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY x(num,ord) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=x.num ORDER BY x.ord),
      'expression',pg_get_expr(k.conbin,k.conrelid,false),
      'functionIds',ARRAY(SELECT DISTINCT d.refobjid::text FROM pg_depend d WHERE d.classid='pg_constraint'::regclass AND d.objid=k.oid AND d.refclassid='pg_proc'::regclass)))
    FROM pg_constraint k WHERE k.conrelid=c.oid) AS constraint_shapes,
   to_regprocedure('lifeos_platform.classification_valid(jsonb,text)')::oid::text AS validator_id,
   (SELECT count(*)=CASE c.relname WHEN 'platform_classification_approval' THEN 6 ELSE 7 END AND bool_and(a.attnotnull=(a.attname<>'grant_id') AND a.atttypid=
      CASE a.attname WHEN 'plan_id' THEN 'uuid'::regtype WHEN 'proposal_revision' THEN 'integer'::regtype
       WHEN 'plan' THEN 'jsonb'::regtype WHEN 'approval' THEN 'jsonb'::regtype WHEN 'receipt' THEN 'jsonb'::regtype ELSE 'text'::regtype END)
     FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      AND a.attname=ANY(ARRAY['owner_id','space_id','plan_id','digest','proposal_revision']||
       CASE c.relname WHEN 'platform_classification_plan' THEN ARRAY['grant_id','plan']
        WHEN 'platform_classification_command' THEN ARRAY['command_key','receipt'] ELSE ARRAY['approval'] END)) AS required_columns,
   has_function_privilege(current_user,to_regprocedure('lifeos_agent.assert_business_grant(text,text,text,text[])'),'EXECUTE') AS authority,
   NOT EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conrelid=c.oid AND NOT k.convalidated) AS validated,
   current_user='lifeos_platform_candidate_runtime' AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreatedb AND NOT r.rolcreaterole
     AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS restricted
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.rolname=current_user
   WHERE n.nspname='lifeos_platform' AND c.relname IN ('platform_classification_plan','platform_classification_approval','platform_classification_command') AND c.relkind='r'`,["((owner_id = current_setting('lifeos.owner_id'::text, true)) AND (space_id = current_setting('lifeos.classification_space_id'::text, true)))"]);
  if(result.rows.length!==3||result.rows.some(row=>row.rls!==true||row.forced!==true||row.independent_owner!==true||row.required!==true||row.excessive!==false||row.public_access!==false||row.other_access!==false||row.policies!==2||row.policy_bound!==true||row.triggers!==true||row.constraint_options!==true||row.required_columns!==true||!qualifiedConstraints(String(row.relname),row.constraint_shapes,row.validator_id)||row.authority!==true||row.validated!==true||row.restricted!==true))throw classificationUnavailable();
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
export function classificationQueries(client:SqlClient,owner:string,space:string,key:string):Pick<ClassificationTransaction,'getClassificationPlan'|'lockClassificationPlan'|'saveClassificationPlan'|'classificationApproval'|'saveClassificationApproval'|'classificationReceipt'|'classificationPlanCommitted'|'classificationPlanReceipt'|'saveClassificationReceipt'|'classificationOAuthProducer'|'saveClassificationOAuthProducer'>{
 validateIdempotencyKey(key);
 const getPlan=async(id:string)=>{const rows=(await client.query('SELECT plan FROM lifeos_platform.platform_classification_plan WHERE owner_id=$1 AND space_id=$2 AND plan_id=$3',[owner,space,validateId(id)])).rows;if(!rows[0])return null;const plan=decodePlan(rows[0].plan);if(plan.ownerId!==owner||plan.spaceId!==space||plan.preview.planId!==validateId(id))throw classificationUnavailable();return plan;};
 return{
  classificationOAuthProducer:async id=>{
   const plan=await getPlan(id);if(!plan)return missing();
   const row=(await client.query(`SELECT jsonb_build_object('schemaVersion',1,'ownerId',owner_id,'spaceId',space_id,'grantId',grant_id,'planId',plan_id::text,'digest',digest,'proposalRevision',proposal_revision,'expiresAt',$4::text,'producerAuthorizationRevision',producer_authorization_revision,'oauthFence',oauth_fence) AS producer,expires_at=$4::timestamptz AS expiry_matches FROM lifeos_platform.platform_classification_oauth_producer WHERE owner_id=$1 AND space_id=$2 AND plan_id=$3`,[owner,space,validateId(id),plan.preview.expiresAt])).rows[0];
   if(!row)return null;if(row.expiry_matches!==true)throw classificationUnavailable();return assertClassificationOAuthProducer(row.producer,plan);
  },
  saveClassificationOAuthProducer:async value=>{
   const plan=await getPlan(value.planId);if(!plan)return missing();const p=assertClassificationOAuthProducer(value,plan);
   await client.query('INSERT INTO lifeos_platform.platform_classification_oauth_producer(owner_id,space_id,plan_id,digest,proposal_revision,grant_id,expires_at,producer_authorization_revision,oauth_fence) VALUES($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9::jsonb)',[owner,space,p.planId,p.digest,p.proposalRevision,p.grantId,p.expiresAt,p.producerAuthorizationRevision,JSON.stringify(p.oauthFence)]);
  },
  getClassificationPlan:getPlan,
  lockClassificationPlan:async id=>{await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([owner,'classification-plan-v1',space,validateId(id)])]);},
  saveClassificationPlan:async value=>{const p=decodePlan(value);if(p.ownerId!==owner||p.spaceId!==space)throw new PlatformError(403,'CLASSIFICATION_OWNER','分类计划空间不匹配。');await client.query('INSERT INTO lifeos_platform.platform_classification_plan(owner_id,space_id,plan_id,digest,proposal_revision,grant_id,plan) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[owner,space,p.preview.planId,p.preview.digest,p.proposalRevision,p.grantId,JSON.stringify(p)]);},
  classificationApproval:async id=>{const rows=(await client.query('SELECT approval FROM lifeos_platform.platform_classification_approval WHERE owner_id=$1 AND space_id=$2 AND plan_id=$3',[owner,space,validateId(id)])).rows;if(!rows[0])return null;const a=decodeApproval(rows[0].approval),p=await getPlan(id);if(!p)return missing();assertApprovalMatchesPlan(a,p);return a;},
  saveClassificationApproval:async value=>{const a=decodeApproval(value),p=await getPlan(a.planId);if(!p)return missing();assertApprovalMatchesPlan(a,p);await client.query('INSERT INTO lifeos_platform.platform_classification_approval(owner_id,space_id,plan_id,digest,proposal_revision,approval) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[owner,space,a.planId,a.digest,a.proposalRevision,JSON.stringify(a)]);},
  classificationReceipt:async()=>{const rows=(await client.query('SELECT receipt FROM lifeos_platform.platform_classification_command WHERE owner_id=$1 AND space_id=$2 AND command_key=$3',[owner,space,key])).rows;if(!rows[0])return null;const receipt=decodeReceipt(rows[0].receipt),plan=await getPlan(receipt.planId);if(!plan)return missing();assertReceiptMatchesPlan(receipt,plan);return receipt;},
  classificationPlanReceipt:async id=>{const rows=(await client.query('SELECT receipt FROM lifeos_platform.platform_classification_command WHERE owner_id=$1 AND space_id=$2 AND plan_id=$3',[owner,space,validateId(id)])).rows;if(!rows[0])return null;const receipt=decodeReceipt(rows[0].receipt),plan=await getPlan(id);if(!plan)return missing();assertReceiptMatchesPlan(receipt,plan);return receipt;},
  classificationPlanCommitted:async id=>(await client.query('SELECT 1 FROM lifeos_platform.platform_classification_command WHERE owner_id=$1 AND space_id=$2 AND plan_id=$3',[owner,space,validateId(id)])).rows.length>0,
  saveClassificationReceipt:async value=>{const receipt=decodeReceipt(value),plan=await getPlan(receipt.planId);if(!plan)return missing();assertReceiptMatchesPlan(receipt,plan);await client.query('INSERT INTO lifeos_platform.platform_classification_command(owner_id,space_id,command_key,plan_id,digest,proposal_revision,receipt) VALUES($1,$2,$3,$4,$5,1,$6::jsonb)',[owner,space,key,receipt.planId,receipt.result.digest,JSON.stringify(receipt)]);},
 };
}
