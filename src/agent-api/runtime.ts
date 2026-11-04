import {readPersonalConfig, type PersonalConfig} from '../personal-candidate/config.ts';
import {requirePersonalBusinessWrite} from '../personal-candidate/runtime-http.ts';
import {readPlatformConfig, type PlatformConfig} from '../platform/config.ts';
import {PlatformError} from '../platform/domain.ts';
import {PostgresPlatformRepository, verifyRestrictedPool, type SqlPool} from '../platform/postgres.ts';
import {assertLocalRequest} from '../platform/request-boundary.ts';
import {agentVerifierRole, readAgentRuntimeConfig, readAgentBusinessModules} from './config.ts';
import {decodeAgentPermissions} from './scopes.ts';
import {createAgentHandler} from './http.ts';

type AgentConfig = NonNullable<ReturnType<typeof readAgentRuntimeConfig>>;
type Handler = ReturnType<typeof createAgentHandler>;

let pending: Promise<Handler> | undefined;

function failure(status: 403 | 404 | 503, code: string): Response {
  return Response.json({error: code}, {status, headers: {
    'Cache-Control': 'private, no-store', Vary: 'Authorization', 'X-Content-Type-Options': 'nosniff',
  }});
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
    const {rows: fences} = await business.query(`SELECT
      has_function_privilege(current_user,to_regprocedure('lifeos_agent.assert_todo_write_grant(text,text,text)'),'EXECUTE') AS can_fence,
      NOT has_table_privilege(current_user,'lifeos_agent.apikey','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS no_key_access,
      NOT has_any_column_privilege(current_user,'lifeos_agent.apikey','SELECT,INSERT,UPDATE,REFERENCES') AS no_key_column_access`);
    if (fences.length !== 1 || Object.values(fences[0]).some(value => value !== true))
      throw Error('Restricted Agent write fence required');
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

    return createAgentHandler({
      enabled: true,
      fenceWrites: true,
      mountPath: '/api/platform/agent',
      config: personal,
      repository: new PostgresPlatformRepository(business as SqlPool, true, true),
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
      assertWritable: async () => requirePersonalBusinessWrite(personal, process.env.LIFEOS_REVIEW_GIT_SHA ?? ''),
    });
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
