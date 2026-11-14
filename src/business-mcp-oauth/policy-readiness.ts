import type {SqlPool} from '../platform/postgres.ts';
import type {BusinessOAuthConfig} from './boundary.ts';
import {policyOAuthSqlFingerprints} from './policy-sql-fingerprints.ts';
/** Additional policy gate. Original OAuth/provider qualification is still mandatory. */
export async function verifyBusinessOAuthPolicyPool(pool:SqlPool,config:BusinessOAuthConfig,owner:{ownerId:string;spaceId:string}):Promise<void>{
 const client=await pool.connect();try{
  const result=await client.query(`WITH expected AS(SELECT key AS signature,value FROM jsonb_each($1::jsonb)),migration AS(SELECT relowner FROM pg_class WHERE oid='lifeos_agent.apikey'::regclass),functions AS(SELECT p.*,e.value FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature))
   SELECT current_user='lifeos_platform_candidate_runtime' AS role,
    (SELECT NOT(rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls OR rolreplication) AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) FROM pg_roles r WHERE rolname=current_user) AS restricted,
    (SELECT count(*)=$2::int AND bool_and(f.oid IS NOT NULL AND f.proowner=m.relowner AND f.prosecdef=(f.value->>'definer')::boolean AND f.provolatile::text=f.value->>'volatility'
     AND f.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[] AND encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')=f.value->>'digest'
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(f.value->'grantees') g(role) WHERE NOT has_function_privilege(g.role,f.oid,'EXECUTE'))
     AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(f.proacl,acldefault('f',f.proowner))) a WHERE a.grantee<>f.proowner AND (a.is_grantable OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(f.value->'grantees') g(role) JOIN pg_roles r ON r.rolname=g.role WHERE r.oid=a.grantee)))) FROM functions f CROSS JOIN migration m) AS functions_safe,
    (SELECT count(*)=1 AND bool_and(c.relkind='r' AND NOT c.relispartition AND c.relowner=m.relowner AND c.relowner<>r.oid AND c.relrowsecurity AND c.relforcerowsecurity
     AND NOT EXISTS(SELECT 1 FROM pg_inherits WHERE inhrelid=c.oid OR inhparent=c.oid)
     AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT')
     AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AND NOT has_any_column_privilege(current_user,c.oid,'UPDATE,REFERENCES')
     AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee NOT IN(c.relowner,r.oid) OR a.is_grantable AND a.grantee<>c.relowner)
     AND (SELECT count(*)=9 AND array_agg(a.attname::text ORDER BY a.attnum)=ARRAY['owner_id','space_id','plan_id','digest','proposal_revision','grant_id','expires_at','producer_authorization_revision','oauth_fence']::text[]
      AND bool_and(a.attnotnull AND a.attacl IS NULL AND NOT a.atthasdef AND a.attidentity='' AND a.attgenerated='' AND a.atttypid=CASE a.attname WHEN 'plan_id' THEN 'uuid'::regtype WHEN 'proposal_revision' THEN 'integer'::regtype WHEN 'expires_at' THEN 'timestamptz'::regtype WHEN 'oauth_fence' THEN 'jsonb'::regtype ELSE 'text'::regtype END)
      FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)
     AND (SELECT count(*)=2 AND bool_and(p.polpermissive AND p.polroles=ARRAY[r.oid] AND CASE p.polcmd WHEN 'r' THEN p.polwithcheck IS NULL AND pg_get_expr(p.polqual,p.polrelid)=$6 WHEN 'a' THEN p.polqual IS NULL AND pg_get_expr(p.polwithcheck,p.polrelid)=$6 ELSE false END) FROM pg_policy p WHERE p.polrelid=c.oid)
     AND (SELECT count(*)=2 AND count(*) FILTER(WHERE t.tgfoid=to_regprocedure('lifeos_platform.classification_oauth_insert_binding()'))=1
      AND bool_and(t.tgenabled='O' AND t.tgattr::text='' AND t.tgqual IS NULL AND t.tgnargs=0 AND octet_length(t.tgargs)=0 AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
       AND ((t.tgfoid=to_regprocedure('lifeos_platform.classification_oauth_insert_binding()') AND t.tgtype=7) OR (t.tgfoid=to_regprocedure('lifeos_platform.classification_immutable()') AND t.tgtype=27))) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)
     AND (SELECT count(*)=3 AND bool_and(k.convalidated AND NOT k.condeferrable AND NOT k.condeferred AND k.conislocal AND k.coninhcount=0 AND CASE k.contype
      WHEN 'c' THEN k.conkey=ARRAY[5]::smallint[] AND pg_get_expr(k.conbin,k.conrelid)='(proposal_revision = 1)'
      WHEN 'p' THEN k.conkey=ARRAY[1,2,3]::smallint[] AND EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid=k.conindid AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate AND i.indpred IS NULL AND i.indexprs IS NULL)
      WHEN 'f' THEN k.conkey=ARRAY[1,2,3,4,5]::smallint[] AND k.confrelid=to_regclass('lifeos_platform.platform_classification_plan') AND k.confkey=ARRAY(SELECT a.attnum FROM unnest(ARRAY['owner_id','space_id','plan_id','digest','proposal_revision']) WITH ORDINALITY x(name,ord) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attname=x.name ORDER BY x.ord) AND k.confmatchtype='s' AND k.confupdtype='a' AND k.confdeltype='a' AND k.confdelsetcols IS NULL
      ELSE false END) FROM pg_constraint k WHERE k.conrelid=c.oid))
     FROM pg_class c CROSS JOIN migration m JOIN pg_roles r ON r.rolname=current_user WHERE c.oid=to_regclass('lifeos_platform.platform_classification_oauth_producer')) AS producer_safe,
    lifeos_agent.oauth_policy_version()='business-mcp-policy-v1' AS version,
    lifeos_agent.oauth_policy_activation_ready($3,$4,$5) AS "current"`,[JSON.stringify(policyOAuthSqlFingerprints),Object.keys(policyOAuthSqlFingerprints).length,config.grantId,owner.ownerId,owner.spaceId,"((owner_id = current_setting('lifeos.owner_id'::text, true)) AND (space_id = current_setting('lifeos.classification_space_id'::text, true)))"]);
  const row=result.rows[0];if(result.rows.length!==1||!row||row.role!==true||row.restricted!==true||row.functions_safe!==true||row.producer_safe!==true||row.version!==true||row.current!==true)throw Error('BUSINESS_MCP_POLICY_SCHEMA_UNAVAILABLE');
 }catch(error){throw new Error('BUSINESS_MCP_POLICY_SCHEMA_UNAVAILABLE',{cause:error});}finally{client.release();}
}
