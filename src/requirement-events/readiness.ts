import {PlatformError} from '../platform/domain.ts';
// Exact invoker trigger body in proposed0020; source-parity regression binds it.
export const requirementEventTriggerDigest='8931c54866d2d68fdf8e8871508605c5464eb7771361576c2f02df76525e5589';
export async function verifyRequirementEventReadiness(pool:{query:(sql:string)=>Promise<{rows:Record<string,unknown>[]}>}){
 const {rows}=await pool.query(`WITH expected(name,privileges) AS (VALUES ('requirement_work',ARRAY['SELECT','INSERT','UPDATE']::text[]),('requirement_event_outbox',ARRAY['SELECT','INSERT','DELETE']::text[]),('requirement_claim_command',ARRAY['SELECT','INSERT']::text[])), owner AS (SELECT relowner FROM pg_class WHERE oid='lifeos_platform.platform_record'::regclass)
 SELECT current_user='lifeos_platform_candidate_runtime' AS role_safe,
 (SELECT count(*)=3 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND c.relowner=o.relowner
  AND (SELECT count(*)=1 AND bool_and(p.polcmd='*' AND p.polpermissive AND p.polroles=ARRAY[0::oid]
   AND pg_get_expr(p.polqual,p.polrelid)='((owner_id = current_setting(''lifeos.owner_id''::text, true)) AND (space_id = current_setting(''lifeos.requirement_event_space''::text, true)))'
   AND pg_get_expr(p.polqual,p.polrelid)=pg_get_expr(p.polwithcheck,p.polrelid)) FROM pg_policy p WHERE p.polrelid=c.oid)
  AND NOT EXISTS(SELECT 1 FROM unnest(e.privileges) privilege WHERE NOT has_table_privilege(current_user,c.oid,privilege))
  AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee NOT IN (c.relowner,(SELECT oid FROM pg_roles WHERE rolname=current_user)) OR a.is_grantable AND a.grantee<>c.relowner)
  AND NOT EXISTS(SELECT 1 FROM pg_attribute col CROSS JOIN LATERAL aclexplode(col.attacl) a WHERE col.attrelid=c.oid AND a.grantee<>c.relowner)
  AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND NOT a.privilege_type=ANY(e.privileges))
 ) FROM expected e LEFT JOIN pg_class c ON c.oid=to_regclass('lifeos_platform.'||e.name) CROSS JOIN owner o) AS tables_safe,
 (SELECT count(*)=1 AND bool_and(t.tgenabled='O' AND NOT t.tgisinternal AND NOT p.prosecdef AND p.proowner=o.relowner AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[] AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='${requirementEventTriggerDigest}'
  AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee NOT IN (p.proowner,(SELECT oid FROM pg_roles WHERE rolname=current_user)) OR a.is_grantable AND a.grantee<>p.proowner)) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid CROSS JOIN owner o WHERE t.tgname='requirement_event_after_write' AND t.tgrelid='lifeos_platform.platform_record'::regclass) AS trigger_safe,
 has_sequence_privilege(current_user,to_regclass('lifeos_platform.requirement_event_outbox_event_id_seq'),'USAGE') AS sequence_safe`);
 if(rows.length!==1||Object.values(rows[0]).some(value=>value!==true))throw new PlatformError(503,'REQUIREMENT_EVENTS_UNAVAILABLE','需求事件结构或权限尚未就绪。');
}
