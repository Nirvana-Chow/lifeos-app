import {readPersonalConfig, type PersonalConfig} from '../personal-candidate/config.ts';
import {requirePersonalBusinessWrite} from '../personal-candidate/runtime-http.ts';
import {readPlatformConfig, type PlatformConfig} from '../platform/config.ts';
import {PlatformError} from '../platform/domain.ts';
import {PostgresPlatformRepository, verifyRestrictedPool, type SqlPool} from '../platform/postgres.ts';
import {assertLocalRequest} from '../platform/request-boundary.ts';
import {agentVerifierRole, readAgentRuntimeConfig, readAgentBusinessModules,type AgentModules} from './config.ts';
import {decodeAgentPermissions} from './scopes.ts';
import {createAgentHandler} from './http.ts';
import {organizationTypes} from './organization.ts';
import {agentOperations} from './capabilities.ts';

type AgentConfig = NonNullable<ReturnType<typeof readAgentRuntimeConfig>>;
type Handler = ReturnType<typeof createAgentHandler>;

let pending: Promise<Handler> | undefined;

function failure(status: 403 | 404 | 503, code: string): Response {
  return Response.json({error: code}, {status, headers: {
    'Cache-Control': 'private, no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff',
  }});
}

type GrantLookupPool = {query:(sql:string,values:string[])=>Promise<{rows:unknown[]}>};
/** Read only current non-secret grant fields; never invoke the quota-counting verifier. */
export async function readCurrentAgentGrant(pool:GrantLookupPool, id:string) {
  const {rows} = await pool.query('SELECT id, "referenceId", metadata, permissions, enabled, "expiresAt" FROM lifeos_agent.apikey WHERE id = $1', [id]);
  if (rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') return null;
  const row = rows[0] as Record<string,unknown>;
  try {
    const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
    const permissions = typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions;
    const scopes = decodeAgentPermissions(permissions);
    const expires = row.expiresAt === null ? null : new Date(row.expiresAt as string|Date).valueOf();
    if (row.id !== id || typeof row.referenceId !== 'string' || !row.referenceId || !metadata || typeof metadata !== 'object' ||
        typeof metadata.spaceId !== 'string' || !metadata.spaceId || row.enabled !== true && row.enabled !== null ||
        expires !== null && (!Number.isFinite(expires) || expires <= Date.now()) || !scopes) return null;
    return {grantId:id,ownerId:row.referenceId,spaceId:metadata.spaceId as string,scopes};
  } catch {return null;}
}

/** Read-only readiness uses the same live business permit as the write guard. */
export function agentOperationAvailable(id:string, personal:PersonalConfig, fenceReady:boolean, modules:AgentModules={organization:false,classification:false}):boolean {
  const operation = agentOperations.find(entry => entry.id === id);
  if (!operation || operation.module === 'catalog') return false;
  if (operation.module === 'todo' && !personal.allowedTypes.includes('todo')) return false;
  if (operation.module === 'organization' && (!modules.organization || !fenceReady || !organizationTypes.every(type=>personal.allowedTypes.includes(type)))) return false;
  if (operation.method === 'GET') return true;
  if (!fenceReady) return false;
  try {requirePersonalBusinessWrite(personal, process.env.LIFEOS_REVIEW_GIT_SHA ?? ''); return true;} catch {return false;}
}

/** Reject unsafe function ownership/search paths/ACLs before enabling the optional business seam. */
export async function verifyAgentBusinessReadiness(pool:{query:(sql:string)=>Promise<{rows:Record<string,unknown>[]} >}):Promise<void>{
  const {rows}=await pool.query(`WITH expected(signature,definer,grantee) AS (VALUES
    ('lifeos_agent.valid_business_permissions(jsonb)',false,'lifeos_agent_key_manager'),
    ('lifeos_agent.managed_grant_digest(text)',true,'lifeos_agent_key_manager'),
    ('lifeos_agent.set_managed_grant_scopes(text,text,text,jsonb)',true,'lifeos_agent_key_manager'),
    ('lifeos_agent.assert_business_grant(text,text,text,text[])',true,'lifeos_platform_candidate_runtime'),
    ('lifeos_agent.assert_todo_write_grant(text,text,text)',true,'lifeos_platform_candidate_runtime')),
    functions AS (SELECT p.*,e.definer,e.grantee FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)),
    owner AS (SELECT c.relowner FROM pg_class c WHERE c.oid='lifeos_agent.apikey'::regclass)
    SELECT (SELECT count(*)=5 AND bool_and(f.oid IS NOT NULL AND f.proowner=o.relowner AND f.prosecdef=f.definer
      AND f.proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
      AND has_function_privilege(f.grantee,f.oid,'EXECUTE')
      AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(f.proacl,acldefault('f',f.proowner))) a
       WHERE a.privilege_type='EXECUTE' AND (a.is_grantable AND a.grantee<>f.proowner OR a.grantee NOT IN (f.proowner,(SELECT oid FROM pg_roles WHERE rolname=f.grantee))))) FROM functions f CROSS JOIN owner o) AS functions_safe,
    (SELECT relowner=(SELECT relowner FROM owner) FROM pg_class WHERE oid='lifeos_agent.key_management_binding'::regclass) AS binding_owner,
    (SELECT relowner=(SELECT relowner FROM owner) FROM pg_class WHERE oid='lifeos_agent.grant_scope_audit'::regclass) AS audit_owner,
    (SELECT count(*)=3 AND bool_and(NOT(r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolbypassrls OR r.rolreplication)
      AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)
      AND r.oid<>(SELECT relowner FROM owner)
      AND NOT has_database_privilege(r.oid,current_database(),'CREATE')
      AND NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_temp_' AND n.nspname !~ '^pg_toast_temp_' AND has_schema_privilege(r.oid,n.oid,'CREATE')))
      FROM pg_roles r WHERE rolname IN ('lifeos_agent_key_manager','lifeos_agent_verifier','lifeos_platform_candidate_runtime')) AS roles_safe,
    NOT has_schema_privilege('lifeos_agent_key_manager','lifeos_platform','USAGE') AND NOT has_schema_privilege('lifeos_agent_verifier','lifeos_platform','USAGE') AS separation,
    NOT EXISTS(SELECT 1 FROM (VALUES ('permissions'),('metadata'),('key'),('expiresAt'),('referenceId')) col(name)
      CROSS JOIN (VALUES ('lifeos_agent_key_manager'),('lifeos_agent_verifier')) role(name)
      WHERE has_column_privilege(role.name,'lifeos_agent.apikey',col.name,'UPDATE')) AS narrow_updates,
    NOT has_column_privilege('lifeos_agent_verifier','lifeos_agent.apikey','enabled','UPDATE')
      AND NOT has_table_privilege('lifeos_agent_verifier','lifeos_agent.apikey','INSERT,TRUNCATE,REFERENCES,TRIGGER') AS verifier_not_manager,
    NOT has_table_privilege('lifeos_platform_candidate_runtime','lifeos_agent.apikey','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      AND NOT has_any_column_privilege('lifeos_platform_candidate_runtime','lifeos_agent.apikey','SELECT,INSERT,UPDATE,REFERENCES') AS runtime_isolation,
    NOT EXISTS(SELECT 1 FROM (VALUES ('lifeos_agent_key_manager'),('lifeos_agent_verifier'),('lifeos_platform_candidate_runtime')) role(name)
      WHERE has_table_privilege(role.name,'lifeos_agent.grant_scope_audit','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(role.name,'lifeos_agent.grant_scope_audit','SELECT,INSERT,UPDATE,REFERENCES')
        OR has_table_privilege(role.name,'lifeos_agent.key_management_binding','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(role.name,'lifeos_agent.key_management_binding','SELECT,INSERT,UPDATE,REFERENCES')) AS private_tables,
    (SELECT relrowsecurity AND relowner NOT IN (SELECT oid FROM pg_roles WHERE rolname IN ('lifeos_agent_key_manager','lifeos_agent_verifier','lifeos_platform_candidate_runtime'))
      FROM pg_class WHERE oid='lifeos_agent.apikey'::regclass) AS key_rls`);
  if(rows.length!==1||Object.values(rows[0]).some(value=>value!==true))
    throw new PlatformError(503,'AGENT_API_UNAVAILABLE','业务授权检查暂不可用。');
}

async function initialize(platform: PlatformConfig, personal: PersonalConfig, config: AgentConfig): Promise<Handler> {
  const [{Pool}, {betterAuth}, {apiKey}] = await Promise.all([
    import('pg'), import('better-auth'), import('@better-auth/api-key'),
  ]);
  const limits = {
    max: 2,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
    lock_timeout: 2000,
    idle_in_transaction_session_timeout: 5000,
    allowExitOnIdle: true,
  };
  const business = new Pool({...limits, connectionString: platform.databaseURL, options: '-c search_path=pg_catalog,lifeos_platform'});
  const verifier = new Pool({...limits, connectionString: config.databaseURL, options: '-c search_path=lifeos_agent,pg_catalog'});

  try {
    await verifyRestrictedPool(business as SqlPool);
    const modules=readAgentBusinessModules(process.env,personal);
    if(modules.organization)await verifyAgentBusinessReadiness(business);
    const {rows: fences} = await business.query(`SELECT
      has_function_privilege(current_user,to_regprocedure('lifeos_agent.assert_todo_write_grant(text,text,text)'),'EXECUTE') AS can_fence,
      NOT has_table_privilege(current_user,'lifeos_agent.apikey','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_key_access,
      NOT has_any_column_privilege(current_user,'lifeos_agent.apikey','SELECT,INSERT,UPDATE,REFERENCES') AS no_key_column_access`);
    const fenceReady = fences.length === 1 && Object.values(fences[0]).every(value => value === true);
    if (!fenceReady) throw Error('Restricted Agent write fence required');
    const {rows} = await verifier.query(`SELECT current_user AS role, current_database() AS database,
      NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolinherit OR r.rolreplication) AS restricted,
      NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS no_memberships,
      NOT has_database_privilege(current_user,current_database(),'CREATE') AS cannot_create_database_objects,
      NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_temp_' AND nspname !~ '^pg_toast_temp_'
        AND has_schema_privilege(current_user,oid,'CREATE')) AS cannot_create_in_schema,
      NOT has_schema_privilege(current_user,'lifeos_platform','USAGE') AS no_business_schema_access,
      has_table_privilege(current_user,'lifeos_agent.apikey','SELECT') AS can_verify,
      NOT has_table_privilege(current_user,'lifeos_agent.apikey','INSERT,TRUNCATE,REFERENCES,TRIGGER') AS cannot_manage_table,
      NOT has_column_privilege(current_user,'lifeos_agent.apikey','enabled','UPDATE') AS cannot_revoke,
      NOT has_column_privilege(current_user,'lifeos_agent.apikey','permissions','UPDATE') AS cannot_grant,
      NOT has_column_privilege(current_user,'lifeos_agent.apikey','metadata','UPDATE') AS cannot_change_binding,
      NOT has_column_privilege(current_user,'lifeos_agent.apikey','referenceId','UPDATE') AS cannot_change_owner,
      NOT has_column_privilege(current_user,'lifeos_agent.apikey','key','UPDATE') AS cannot_replace_key,
      c.relrowsecurity AND c.relowner<>r.oid AS key_rls
      FROM pg_roles r JOIN pg_class c ON c.oid='lifeos_agent.apikey'::regclass WHERE r.rolname=current_user`);
    const grants = rows[0];
    if (rows.length !== 1 || !grants || grants.role !== agentVerifierRole || grants.database !== personal.databaseName ||
        Object.entries(grants).some(([key, value]) => key !== 'role' && key !== 'database' && value !== true)) {
      throw Error('Restricted Agent verifier required');
    }

    const auth = betterAuth({
      baseURL: personal.baseURL,
      secret: config.secret,
      database: verifier,
      logger: {disabled: true},
      telemetry: {enabled: false},
      plugins: [apiKey({enableSessionForAPIKeys: false, enableMetadata: true, startingCharactersConfig: {shouldStore: false}})],
    });
    await auth.$context;

    const handler=createAgentHandler({
      enabled: true,
      modules,
      fenceWrites: true,
      mountPath: '/api/platform/agent',
      config: personal,
      repository: new PostgresPlatformRepository(business as SqlPool, true, true, modules),
      verify: async token => {
        const result = await auth.api.verifyApiKey({body: {key: token}});
        if (result.error?.code === 'RATE_LIMITED') throw new PlatformError(429, 'RATE_LIMITED', '请求过于频繁。');
        const key = result.key;
        const spaceId = key?.metadata?.spaceId;
        if (!result.valid || !key || typeof spaceId !== 'string') return null;
        const scopes = decodeAgentPermissions(key.permissions);
        if (!scopes) return null;
        return {grantId: key.id, ownerId: key.referenceId, spaceId, scopes};
      },
      readCurrentGrant: id => readCurrentAgentGrant(verifier, id),
      operationAvailable: id => agentOperationAvailable(id, personal, fenceReady,modules),
      assertWritable: async () => requirePersonalBusinessWrite(personal, process.env.LIFEOS_REVIEW_GIT_SHA ?? ''),
    });
    return modules.organization?async request=>{await verifyAgentBusinessReadiness(business);return handler(request);}:handler;
  } catch (error) {
    await Promise.allSettled([business.end(), verifier.end()]);
    throw error;
  }
}

export async function handleAgentRequest(request: Request): Promise<Response> {
  if (process.env.LIFEOS_AGENT_API_ENABLED !== '1') return failure(404, 'NOT_FOUND');
  try {
    const platform = readPlatformConfig(process.env);
    const personal = platform ? readPersonalConfig(process.env, platform) : null;
    const config = platform ? readAgentRuntimeConfig(process.env, platform, personal) : null;
    if (!platform || !personal || !config) return failure(503, 'AGENT_API_UNAVAILABLE');
    readAgentBusinessModules(process.env, personal);

    // Reject a mismatched host before opening either pool.
    assertLocalRequest(request, platform.baseURL);
    pending ??= initialize(platform, personal, config).catch(error => {
      pending = undefined;
      throw error;
    });
    return await (await pending)(request);
  } catch (error) {
    if (error instanceof PlatformError && error.code === 'ORIGIN_DENIED') return failure(403, 'ORIGIN_DENIED');
    return failure(503, 'AGENT_API_UNAVAILABLE');
  }
}
