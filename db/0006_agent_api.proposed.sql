-- Controlled migration. Run in CI only against the disposable fixture.
-- The migration operator must set lifeos.agent_migration_approved = '1'
-- and lifeos.agent_expected_database to the separately reviewed target name
-- in the same session. Pre-existing roles only; creates no users or secrets.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
DO $$
DECLARE
 restricted_role text;
BEGIN
 IF current_setting('lifeos.agent_migration_approved', true) IS DISTINCT FROM '1'
    OR current_setting('lifeos.agent_expected_database', true) IS DISTINCT FROM current_database()
    OR current_user IN ('lifeos_platform_candidate_runtime', 'lifeos_platform_candidate_bootstrap',
                        'lifeos_agent_issuer', 'lifeos_agent_verifier')
    OR to_regnamespace('lifeos_agent') IS NOT NULL
    OR to_regclass('lifeos_platform.platform_meta') IS NULL THEN
  RAISE EXCEPTION 'Explicit Agent migration approval, exact target and separate migration owner required';
 END IF;
 IF (SELECT version FROM lifeos_platform.platform_meta) IS DISTINCT FROM 2 THEN
  RAISE EXCEPTION 'Agent migration requires platform schema version 2';
 END IF;

 FOREACH restricted_role IN ARRAY ARRAY['lifeos_agent_issuer', 'lifeos_agent_verifier'] LOOP
  IF NOT EXISTS (
   SELECT 1 FROM pg_roles r
    WHERE r.rolname = restricted_role
      AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolbypassrls OR r.rolreplication)
      AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid)
      AND NOT has_database_privilege(r.oid, current_database(), 'CREATE')
      AND NOT has_schema_privilege(r.oid, 'lifeos_platform', 'USAGE')
  ) THEN
   RAISE EXCEPTION 'Pre-existing isolated Agent issuer and verifier roles required';
  END IF;
 END LOOP;
END
$$;

CREATE SCHEMA lifeos_agent;
REVOKE ALL ON SCHEMA lifeos_agent FROM PUBLIC;

-- Better Auth verifies its core schema at startup even for a server-only
-- key plugin. Copy only the column definitions, never auth rows.
CREATE TABLE lifeos_agent."user" (LIKE lifeos_platform.platform_user);
CREATE TABLE lifeos_agent.session (LIKE lifeos_platform.platform_session);
CREATE TABLE lifeos_agent.account (LIKE lifeos_platform.platform_account);
CREATE TABLE lifeos_agent.verification (LIKE lifeos_platform.platform_verification);
GRANT SELECT ON lifeos_agent."user", lifeos_agent.session,
 lifeos_agent.account, lifeos_agent.verification
 TO lifeos_agent_issuer, lifeos_agent_verifier;

CREATE TABLE lifeos_agent.apikey (
 id text PRIMARY KEY,
 "configId" text NOT NULL,
 name text,
 start text,
 "referenceId" text NOT NULL,
 prefix text,
 key text NOT NULL,
 "refillInterval" integer,
 "refillAmount" integer,
 "lastRefillAt" timestamptz,
 enabled boolean,
 "rateLimitEnabled" boolean,
 "rateLimitTimeWindow" integer,
 "rateLimitMax" integer,
 "requestCount" integer,
 remaining integer,
 "lastRequest" timestamptz,
 "expiresAt" timestamptz,
 "createdAt" timestamptz NOT NULL,
 "updatedAt" timestamptz NOT NULL,
 permissions text,
 metadata text
);
CREATE UNIQUE INDEX agent_key_digest ON lifeos_agent.apikey (key);
REVOKE ALL ON ALL TABLES IN SCHEMA lifeos_agent FROM PUBLIC;
GRANT USAGE ON SCHEMA lifeos_agent TO lifeos_agent_issuer, lifeos_agent_verifier;
GRANT SELECT, INSERT, UPDATE, DELETE ON lifeos_agent.apikey TO lifeos_agent_issuer;
-- The pinned verifier updates usage counters and deletes expired rows.
GRANT SELECT, DELETE ON lifeos_agent.apikey TO lifeos_agent_verifier;
GRANT UPDATE ("requestCount", "lastRequest", "updatedAt", remaining, "lastRefillAt")
 ON lifeos_agent.apikey TO lifeos_agent_verifier;

ALTER TABLE lifeos_agent.apikey ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_issuer_manage ON lifeos_agent.apikey TO lifeos_agent_issuer
 USING (true) WITH CHECK (true);
CREATE POLICY agent_verifier_read ON lifeos_agent.apikey FOR SELECT TO lifeos_agent_verifier
 USING (true);
CREATE POLICY agent_verifier_usage ON lifeos_agent.apikey FOR UPDATE TO lifeos_agent_verifier
 USING (true) WITH CHECK (true);
CREATE POLICY agent_verifier_expiry_cleanup ON lifeos_agent.apikey FOR DELETE TO lifeos_agent_verifier
 USING ("expiresAt" <= clock_timestamp());

-- Expose only the transactional fence to the business runtime.
CREATE FUNCTION lifeos_agent.assert_todo_write_grant(grant_id text, owner_id text, space_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
 IF current_setting('lifeos.owner_id', true) IS DISTINCT FROM owner_id THEN
  RETURN false;
 END IF;
 PERFORM 1 FROM lifeos_agent.apikey
  WHERE id = grant_id AND "referenceId" = owner_id AND metadata::jsonb->>'spaceId' = space_id
   AND permissions::jsonb->'todo' ? 'write' AND enabled IS TRUE
   AND "expiresAt" > clock_timestamp()
  FOR SHARE;
 IF NOT FOUND THEN
  RETURN false;
 END IF;
 -- Recheck clock time after any wait for the row lock.
 RETURN EXISTS (SELECT 1 FROM lifeos_agent.apikey
  WHERE id = grant_id AND "expiresAt" > clock_timestamp());
END
$$;
REVOKE ALL ON FUNCTION lifeos_agent.assert_todo_write_grant(text,text,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA lifeos_agent TO lifeos_platform_candidate_runtime;
GRANT EXECUTE ON FUNCTION lifeos_agent.assert_todo_write_grant(text,text,text) TO lifeos_platform_candidate_runtime;

COMMIT;
