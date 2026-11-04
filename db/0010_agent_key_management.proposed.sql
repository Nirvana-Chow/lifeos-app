-- Explicitly qualified on a disposable PostgreSQL target. Never run on launch.
-- Requires the existing Agent schema, native owner MFA and a pre-created
-- dedicated key manager role. The application/verifier roles remain unchanged.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
DO $$
BEGIN
 IF current_setting('lifeos.agent_key_management_approved',true) IS DISTINCT FROM '1'
    OR current_setting('lifeos.agent_expected_database',true) IS DISTINCT FROM current_database()
    OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap',
                        'lifeos_agent_issuer','lifeos_agent_verifier','lifeos_agent_key_manager')
    OR to_regclass('lifeos_agent.apikey') IS NULL
    OR to_regclass('lifeos_platform.platform_two_factor') IS NULL
    OR (SELECT version FROM lifeos_platform.platform_meta) IS DISTINCT FROM 2
    OR NOT EXISTS (
      SELECT 1 FROM pg_roles r
      WHERE r.rolname='lifeos_agent_key_manager' AND r.rolcanlogin
        AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolbypassrls OR r.rolreplication)
        AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid)
        AND NOT has_database_privilege(r.oid,current_database(),'CREATE')
        AND NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_temp_' AND n.nspname !~ '^pg_toast_temp_' AND has_schema_privilege(r.oid,n.oid,'CREATE'))
        AND NOT has_schema_privilege(r.oid,'lifeos_platform','USAGE')
    ) THEN
  RAISE EXCEPTION 'Explicit Agent management approval, exact target, restricted role and owner MFA required';
 END IF;
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO lifeos_agent_key_manager',current_database());
END
$$;

GRANT USAGE ON SCHEMA lifeos_agent TO lifeos_agent_key_manager;
GRANT SELECT ON lifeos_agent."user", lifeos_agent.session, lifeos_agent.account, lifeos_agent.verification
 TO lifeos_agent_key_manager;
GRANT SELECT, INSERT, DELETE ON lifeos_agent.apikey TO lifeos_agent_key_manager;
GRANT UPDATE (enabled,"updatedAt") ON lifeos_agent.apikey TO lifeos_agent_key_manager;

CREATE POLICY agent_manager_read ON lifeos_agent.apikey FOR SELECT TO lifeos_agent_key_manager USING (true);
CREATE POLICY agent_manager_issue ON lifeos_agent.apikey FOR INSERT TO lifeos_agent_key_manager WITH CHECK (
 enabled IS TRUE AND "expiresAt" > statement_timestamp() AND "expiresAt" <= statement_timestamp()+interval '8760 hours'
 AND "configId"='default' AND "rateLimitEnabled" IS TRUE AND "rateLimitTimeWindow"=60000 AND "rateLimitMax"=20
 AND permissions::jsonb IN ('{"todo":["read"]}'::jsonb,'{"todo":["read","write"]}'::jsonb)
 AND jsonb_typeof(metadata::jsonb)='object' AND metadata::jsonb ? 'spaceId'
);
CREATE POLICY agent_manager_revoke ON lifeos_agent.apikey FOR UPDATE TO lifeos_agent_key_manager
 USING (true) WITH CHECK (enabled IS FALSE);
-- Better Auth invokes expiry cleanup on create. An active grant is never deletable by this role.
CREATE POLICY agent_manager_cleanup ON lifeos_agent.apikey FOR DELETE TO lifeos_agent_key_manager
 USING ("expiresAt" <= statement_timestamp());

-- Only a yes/no answer. The management role cannot read the owner schema or
-- access session, owner, factor, password, or recovery rows.
CREATE FUNCTION lifeos_agent.verify_management_session(session_token text, owner_id text, owner_email text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT EXISTS (
  SELECT 1 FROM lifeos_platform.platform_session s
   JOIN lifeos_platform.platform_user u ON u.id=s."userId"
   JOIN lifeos_platform.platform_two_factor f ON f."userId"=u.id
  WHERE s.token=session_token AND s."expiresAt">statement_timestamp() AND s."mfaVerified" IS TRUE
    AND u.id=owner_id AND lower(u.email)=owner_email AND u."twoFactorEnabled" IS TRUE
    AND f.verified IS TRUE
 )
$$;
REVOKE ALL ON FUNCTION lifeos_agent.verify_management_session(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lifeos_agent.verify_management_session(text,text,text) TO lifeos_agent_key_manager;

COMMIT;
