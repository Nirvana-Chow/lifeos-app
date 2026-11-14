import type {SqlPool} from '../platform/postgres.ts';
import type {BusinessOAuthConfig} from './boundary.ts';
import {oauthSqlFingerprints} from './sql-fingerprints.ts';
import {agentOperations} from '../agent-api/capabilities.ts';
import {isOAuthBusinessOperation} from './boundary.ts';
import {verifyFilePermissionPool} from '../file-handoff/readiness.ts';
import {reviewedSessionBodyDigests} from '../agent-api/session-freshness-sql-digests.ts';
export async function verifyBusinessOAuthPool(pool:SqlPool,config:BusinessOAuthConfig,owner:{ownerId:string;ownerEmail:string;spaceId:string}):Promise<void>{
 const files=config.scopes.some(scope=>scope.startsWith('file-handoff:'));
 if(files)await verifyFilePermissionPool(pool,'lifeos_platform_candidate_runtime');
 const client=await pool.connect();try{
  const result=await client.query(`WITH expected AS (SELECT key AS name,value AS digests FROM jsonb_each($1::jsonb)), migration AS(SELECT relowner FROM pg_class WHERE oid='lifeos_agent.apikey'::regclass), functions AS(SELECT p.*,e.digests FROM expected e LEFT JOIN pg_proc p ON p.proname=e.name AND p.pronamespace='lifeos_agent'::regnamespace)
   SELECT current_user='lifeos_platform_candidate_runtime' AS role,
    (SELECT NOT(rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls OR rolreplication) AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) FROM pg_roles r WHERE rolname=current_user) AS restricted,
    (SELECT count(*)=$2::int AND bool_and(f.oid IS NOT NULL AND encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')=ANY(ARRAY(SELECT jsonb_array_elements_text(f.digests))) AND f.proowner=m.relowner AND f.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[] AND (f.proname='oauth_business_version' OR f.prosecdef) AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(f.proacl,acldefault('f',f.proowner))) a WHERE a.grantee NOT IN(f.proowner,(SELECT oid FROM pg_roles WHERE rolname=current_user)) OR a.is_grantable AND a.grantee<>f.proowner)) FROM functions f CROSS JOIN migration m) AS functions_safe,
    (SELECT count(*)=4 AND bool_and(NOT has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AND NOT has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')) FROM pg_class c WHERE c.relnamespace='lifeos_agent'::regnamespace AND c.relname IN('oauth_business_control','oauth_business_binding','oauth_business_token','oauth_business_operation')) AS private_ledger,
    (SELECT count(*)=8 AND bool_and(c.relowner=(SELECT relowner FROM pg_class WHERE oid='lifeos_platform.platform_user'::regclass) AND has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND has_table_privilege(current_user,c.oid,'UPDATE') AND has_table_privilege(current_user,c.oid,'DELETE') AND NOT has_table_privilege(current_user,c.oid,'TRUNCATE,REFERENCES,TRIGGER')) FROM pg_class c WHERE c.relnamespace='lifeos_platform'::regnamespace AND c.relname IN('platform_oauth_client','platform_oauth_resource','platform_oauth_client_resource','platform_oauth_refresh_token','platform_oauth_access_token','platform_oauth_consent','platform_oauth_client_assertion','platform_oauth_jwks')) AS provider_tables,
    (SELECT count(*)=15 AND bool_and(t.tgenabled='O' AND NOT t.tgisinternal) FROM pg_trigger t WHERE t.tgname='oauth_business_gate') AS statement_gates,
    (SELECT count(*)=5 AND bool_and(t.tgenabled='O') FROM pg_trigger t WHERE t.tgname='oauth_business_invalidate') AS invalidation,
    (SELECT count(*)=1 AND bool_and(t.tgenabled='O') FROM pg_trigger t WHERE t.tgname='oauth_business_code_guard') AS code_guard,
    (SELECT count(*)=3 AND bool_and(t.tgenabled='O') FROM pg_trigger t WHERE t.tgname='oauth_business_security_invalidate') AS security_reset,
    lifeos_agent.oauth_business_version()='business-mcp-oauth-v1' AS version`,[JSON.stringify(Object.fromEntries(Object.entries(oauthSqlFingerprints).map(([name,digest])=>[name,reviewedSessionBodyDigests(name,digest)]))),Object.keys(oauthSqlFingerprints).length]);
  if(result.rows.length!==1||Object.values(result.rows[0]).some(value=>value!==true))throw Error('BUSINESS_MCP_OAUTH_SCHEMA_UNAVAILABLE');
  const value=(await client.query('SELECT lifeos_agent.oauth_business_activation() AS value')).rows[0]?.value as Record<string,unknown>|undefined;
  if(!value||value.enabled!==true||value.ownerId!==owner.ownerId||value.ownerEmail!==owner.ownerEmail||value.spaceId!==owner.spaceId||value.grantId!==config.grantId||value.resource!==config.resource||value.issuer!==config.issuer||!Array.isArray(value.scopes)||JSON.stringify([...value.scopes].sort())!==JSON.stringify([...config.scopes].sort()))throw Error('BUSINESS_MCP_OAUTH_ACTIVATION_UNAVAILABLE');
  const expected=Object.fromEntries(agentOperations.filter(op=>isOAuthBusinessOperation(op.id)&&(files||op.module!=='fileHandoff')).map(op=>[op.id,[...op.requiredScopes]]));
  const raw=value.operations as Record<string,unknown>|undefined;
  const actual=raw?Object.fromEntries(Object.entries(raw).filter(([id])=>files||!['stageFileHandoff','getFileHandoff'].includes(id))):undefined;
  if(!actual||Object.keys(actual).length!==Object.keys(expected).length||Object.entries(expected).some(([id,scopes])=>!Array.isArray(actual[id])||JSON.stringify([...(actual[id] as string[])].sort())!==JSON.stringify([...(scopes??[])].sort())))throw Error('BUSINESS_MCP_OAUTH_OPERATIONS_UNAVAILABLE');
 }finally{client.release();}
}
