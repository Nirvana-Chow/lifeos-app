-- PROPOSED ONLY: never applied by build/start/routes/tests.
-- Requires a separately approved isolated database, migration owner and pre-created restricted runtime role.
-- Creates no role, account, password or real records. Refuses non-test database names.
BEGIN;
DO $$ BEGIN
 IF current_database() !~ '^lifeos_platform_test_[a-z0-9_]+$' OR current_user='lifeos_platform_candidate_runtime' THEN
  RAISE EXCEPTION 'Approved isolated migration owner and test database required';
 END IF;
END $$;
CREATE SCHEMA lifeos_platform;
REVOKE ALL ON SCHEMA lifeos_platform FROM PUBLIC;
CREATE TABLE lifeos_platform.platform_meta(version integer PRIMARY KEY CHECK(version=1));
INSERT INTO lifeos_platform.platform_meta(version) VALUES(1);
CREATE TABLE lifeos_platform.platform_user(
 id text PRIMARY KEY,name text NOT NULL,email text NOT NULL UNIQUE,"emailVerified" boolean NOT NULL DEFAULT false,image text,
 "createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE lifeos_platform.platform_session(
 id text PRIMARY KEY,"expiresAt" timestamptz NOT NULL,token text NOT NULL UNIQUE,"createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now(),
 "ipAddress" text,"userAgent" text,"userId" text NOT NULL REFERENCES lifeos_platform.platform_user(id)
);
CREATE INDEX platform_session_user_idx ON lifeos_platform.platform_session("userId");
CREATE TABLE lifeos_platform.platform_account(
 id text PRIMARY KEY,"accountId" text NOT NULL,"providerId" text NOT NULL,"userId" text NOT NULL REFERENCES lifeos_platform.platform_user(id),
 "accessToken" text,"refreshToken" text,"idToken" text,"accessTokenExpiresAt" timestamptz,"refreshTokenExpiresAt" timestamptz,scope text,password text,
 "createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now(),UNIQUE("providerId","accountId")
);
CREATE INDEX platform_account_user_idx ON lifeos_platform.platform_account("userId");
CREATE TABLE lifeos_platform.platform_verification(id text PRIMARY KEY,identifier text NOT NULL,value text NOT NULL,"expiresAt" timestamptz NOT NULL,"createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now());
CREATE INDEX platform_verification_identifier_idx ON lifeos_platform.platform_verification(identifier);
CREATE TABLE lifeos_platform.platform_rate_limit(id text PRIMARY KEY,key text NOT NULL UNIQUE,count integer NOT NULL,"lastRequest" bigint NOT NULL);
CREATE TABLE lifeos_platform.platform_source(
 owner_id text NOT NULL REFERENCES lifeos_platform.platform_user(id),id uuid NOT NULL,system text NOT NULL CHECK(system='website'),external_id text NOT NULL,
 version integer NOT NULL CHECK(version=1),as_of timestamptz NOT NULL,original jsonb NOT NULL CHECK(jsonb_typeof(original)='object'),
 PRIMARY KEY(owner_id,id),UNIQUE(owner_id,system,external_id,version)
);
CREATE TABLE lifeos_platform.platform_record(
 owner_id text NOT NULL REFERENCES lifeos_platform.platform_user(id),id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('todo','finance')),source_id uuid NOT NULL,
 draft jsonb NOT NULL CHECK(jsonb_typeof(draft)='object'),revision integer NOT NULL CHECK(revision>=1),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
 original_entry_id uuid,PRIMARY KEY(owner_id,id),UNIQUE(owner_id,source_id),
 FOREIGN KEY(owner_id,source_id) REFERENCES lifeos_platform.platform_source(owner_id,id),
 FOREIGN KEY(owner_id,original_entry_id) REFERENCES lifeos_platform.platform_record(owner_id,id),CHECK(original_entry_id IS NULL OR original_entry_id<>id),
 CHECK((CASE WHEN kind='todo' THEN jsonb_typeof(draft->'title')='string' AND length(draft->>'title') BETWEEN 1 AND 240 AND draft->>'status' IN ('open','in_progress','done','cancelled') AND original_entry_id IS NULL
  ELSE draft->>'kind' IN ('expense','income','refund','transfer','repayment') AND draft->>'currency'='CNY' AND jsonb_typeof(draft->'amountMinor')='number' AND (draft->>'amountMinor')::numeric BETWEEN 1 AND 1000000000000 AND (draft->>'amountMinor')::numeric=trunc((draft->>'amountMinor')::numeric)
   AND CASE WHEN draft->>'kind'='refund' THEN original_entry_id IS NOT NULL AND original_entry_id::text=draft->>'originalEntryId' ELSE original_entry_id IS NULL END END) IS TRUE)
);
CREATE INDEX platform_record_owner_kind_idx ON lifeos_platform.platform_record(owner_id,kind,created_at DESC);
CREATE INDEX platform_record_refund_idx ON lifeos_platform.platform_record(owner_id,original_entry_id) WHERE original_entry_id IS NOT NULL;
CREATE TABLE lifeos_platform.platform_history(
 owner_id text NOT NULL,record_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>=1),raw jsonb NOT NULL,snapshot jsonb NOT NULL,created_at timestamptz NOT NULL,
 PRIMARY KEY(owner_id,record_id,revision),FOREIGN KEY(owner_id,record_id) REFERENCES lifeos_platform.platform_record(owner_id,id)
);
CREATE TABLE lifeos_platform.platform_command(
 owner_id text NOT NULL REFERENCES lifeos_platform.platform_user(id),command_key text NOT NULL CHECK(command_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$'),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,command_key)
);
ALTER TABLE lifeos_platform.platform_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.platform_source FORCE ROW LEVEL SECURITY;
CREATE POLICY source_owner ON lifeos_platform.platform_source USING(owner_id=current_setting('lifeos.owner_id',true)) WITH CHECK(owner_id=current_setting('lifeos.owner_id',true));
ALTER TABLE lifeos_platform.platform_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.platform_record FORCE ROW LEVEL SECURITY;
CREATE POLICY record_owner ON lifeos_platform.platform_record USING(owner_id=current_setting('lifeos.owner_id',true)) WITH CHECK(owner_id=current_setting('lifeos.owner_id',true));
ALTER TABLE lifeos_platform.platform_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.platform_history FORCE ROW LEVEL SECURITY;
CREATE POLICY history_owner ON lifeos_platform.platform_history USING(owner_id=current_setting('lifeos.owner_id',true)) WITH CHECK(owner_id=current_setting('lifeos.owner_id',true));
ALTER TABLE lifeos_platform.platform_command ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.platform_command FORCE ROW LEVEL SECURITY;
CREATE POLICY command_owner ON lifeos_platform.platform_command USING(owner_id=current_setting('lifeos.owner_id',true)) WITH CHECK(owner_id=current_setting('lifeos.owner_id',true));
REVOKE ALL ON ALL TABLES IN SCHEMA lifeos_platform FROM PUBLIC;
GRANT USAGE ON SCHEMA lifeos_platform TO lifeos_platform_candidate_runtime;
GRANT SELECT ON lifeos_platform.platform_meta,lifeos_platform.platform_user,lifeos_platform.platform_account,lifeos_platform.platform_verification TO lifeos_platform_candidate_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON lifeos_platform.platform_session,lifeos_platform.platform_rate_limit TO lifeos_platform_candidate_runtime;
GRANT SELECT,INSERT ON lifeos_platform.platform_source,lifeos_platform.platform_history,lifeos_platform.platform_command,lifeos_platform.platform_record TO lifeos_platform_candidate_runtime;
GRANT UPDATE(draft,revision,updated_at,original_entry_id) ON lifeos_platform.platform_record TO lifeos_platform_candidate_runtime;
COMMIT;
