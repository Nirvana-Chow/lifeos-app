-- Disposable CI fixture for @better-auth/api-key 1.7.15 only.
DO $$
BEGIN
 IF current_database() <> 'lifeos_platform_test_local' THEN
  RAISE EXCEPTION 'Expected the disposable Agent API fixture database';
 END IF;
END
$$;

CREATE SCHEMA lifeos_agent_fixture;
REVOKE ALL ON SCHEMA lifeos_agent_fixture FROM PUBLIC;

-- Better Auth verifies its core schema at startup even for a server-only
-- key plugin. Copy only the disposable column definitions, never auth rows.
CREATE TABLE lifeos_agent_fixture."user" (LIKE lifeos_platform.platform_user);
CREATE TABLE lifeos_agent_fixture.session (LIKE lifeos_platform.platform_session);
CREATE TABLE lifeos_agent_fixture.account (LIKE lifeos_platform.platform_account);
CREATE TABLE lifeos_agent_fixture.verification (LIKE lifeos_platform.platform_verification);
GRANT SELECT ON lifeos_agent_fixture."user", lifeos_agent_fixture.session,
 lifeos_agent_fixture.account, lifeos_agent_fixture.verification
 TO lifeos_agent_fixture_issuer, lifeos_agent_fixture_verifier;

CREATE TABLE lifeos_agent_fixture.apikey (
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
CREATE UNIQUE INDEX agent_fixture_key_digest ON lifeos_agent_fixture.apikey (key);
REVOKE ALL ON TABLE lifeos_agent_fixture.apikey FROM PUBLIC;
GRANT USAGE ON SCHEMA lifeos_agent_fixture TO lifeos_agent_fixture_issuer, lifeos_agent_fixture_verifier;
GRANT SELECT, INSERT, UPDATE, DELETE ON lifeos_agent_fixture.apikey TO lifeos_agent_fixture_issuer;
-- The pinned verifier updates usage counters and deletes expired rows.
GRANT SELECT, DELETE ON lifeos_agent_fixture.apikey TO lifeos_agent_fixture_verifier;
GRANT UPDATE ("requestCount", "lastRequest", "updatedAt", remaining, "lastRefillAt", metadata)
 ON lifeos_agent_fixture.apikey TO lifeos_agent_fixture_verifier;

ALTER TABLE lifeos_agent_fixture.apikey ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_issuer_manage ON lifeos_agent_fixture.apikey TO lifeos_agent_fixture_issuer
 USING (true) WITH CHECK (true);
CREATE POLICY agent_verifier_read ON lifeos_agent_fixture.apikey FOR SELECT TO lifeos_agent_fixture_verifier
 USING (true);
CREATE POLICY agent_verifier_usage ON lifeos_agent_fixture.apikey FOR UPDATE TO lifeos_agent_fixture_verifier
 USING (true) WITH CHECK (true);
CREATE POLICY agent_verifier_expiry_cleanup ON lifeos_agent_fixture.apikey FOR DELETE TO lifeos_agent_fixture_verifier
 USING ("expiresAt" <= clock_timestamp());
