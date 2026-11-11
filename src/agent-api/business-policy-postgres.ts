import {agentCapabilityOperations as agentOperations} from './capabilities.ts';
import {allPersonalBusinessPolicy,policyOperationScopes} from './business-policy.ts';
import {businessPolicySqlDigests} from './business-policy-sql-digests.ts';

type Pool={query:(sql:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[]} >};
export type BusinessPolicyCatalog=Readonly<{version:typeof allPersonalBusinessPolicy;enabled:boolean;operations:readonly Readonly<{id:string;requiredScopes:readonly string[];enabled:boolean}>[]}>;
/** No client-provided registry: only the independent migration owner can register reviewed operations. */
export async function readBusinessPolicyCatalog(pool:Pool):Promise<BusinessPolicyCatalog>{
 const {rows}=await pool.query(`WITH expected(signature,definer,grantees,digest) AS (VALUES
 ${Object.entries(businessPolicySqlDigests).map(([signature,{definer,grantees,digest}])=>`('${signature}',${definer},ARRAY[${grantees.map(role=>`'${role}'`).join(',')}]::text[],'${digest}')`).join(',\n ')}),
 owner AS (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.apikey'::regclass)
 SELECT (SELECT count(*)=${Object.keys(businessPolicySqlDigests).length} AND bool_and(p.oid IS NOT NULL AND p.proowner=o.relowner AND p.prosecdef=e.definer
 AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[] AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=e.digest
 AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND (a.is_grantable AND a.grantee<>p.proowner OR a.grantee NOT IN (p.proowner) AND NOT a.grantee=ANY(ARRAY(SELECT oid FROM pg_roles WHERE rolname=ANY(e.grantees)))))
 AND NOT EXISTS(SELECT 1 FROM unnest(e.grantees) role WHERE NOT has_function_privilege(role,p.oid,'EXECUTE')))
 FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) CROSS JOIN owner o) AS functions_safe,
 (SELECT count(*)=2 AND bool_and(c.relowner=o.relowner
 AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl WHERE acl.grantee<>c.relowner)
 AND NOT EXISTS(SELECT 1 FROM pg_attribute col CROSS JOIN LATERAL aclexplode(CASE WHEN cardinality(col.attacl)>0 THEN col.attacl END) acl
  WHERE col.attrelid=c.oid AND NOT col.attisdropped AND acl.grantee<>c.relowner)
 AND NOT EXISTS(SELECT 1 FROM (VALUES ('lifeos_agent_key_manager'),('lifeos_agent_verifier'),('lifeos_platform_candidate_runtime')) role(name)
 WHERE has_table_privilege(role.name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(role.name,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
 FROM pg_class c CROSS JOIN owner o WHERE c.oid IN ('lifeos_agent.business_policy_control'::regclass,'lifeos_agent.business_policy_operation'::regclass)) AS registry_safe`);
 if(rows.length!==1||rows[0].functions_safe!==true||rows[0].registry_safe!==true)throw Error('Business policy qualification unavailable');
 const result=await pool.query('SELECT lifeos_agent.business_policy_catalog() AS catalog');
 const catalog=result.rows[0]?.catalog as BusinessPolicyCatalog|undefined;
 if(result.rows.length!==1||!catalog||catalog.version!==allPersonalBusinessPolicy||typeof catalog.enabled!=='boolean'||!Array.isArray(catalog.operations)||new Set(catalog.operations.map(op=>op.id)).size!==catalog.operations.length)throw Error('Business policy registry unavailable');
 for(const entry of catalog.operations){
  const expected=agentOperations.find(op=>op.id===entry.id);
  if(!expected||policyOperationScopes(expected)===null||typeof entry.enabled!=='boolean'||!Array.isArray(entry.requiredScopes)||JSON.stringify(expected.requiredScopes)!==JSON.stringify(entry.requiredScopes))throw Error('Business policy registry mismatch');
 }
 return Object.freeze(catalog);
}
