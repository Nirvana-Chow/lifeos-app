-- PROPOSED ONLY: no execution/migration/GRANT authority from this file.
-- Raw review staging only; Apple/Xunji remain official sources.
-- Separate approved operator, backup decision and verified writer are prerequisites.
BEGIN;
DO $$ BEGIN
 IF current_setting('lifeos.data_intake_migration_approved',true) IS DISTINCT FROM 'raw-intake-v1'
  OR current_database()<>'lifeos_platform_test_local'
  OR current_user<>'lifeos_platform_candidate_migrator'
  OR (SELECT version FROM lifeos_platform.platform_meta) IS DISTINCT FROM 2
  OR to_regclass('lifeos_platform.platform_intake_batch') IS NOT NULL
  OR to_regclass('lifeos_platform.platform_intake_item') IS NOT NULL
  OR to_regclass('lifeos_platform.platform_intake_command') IS NOT NULL THEN
  RAISE EXCEPTION 'Explicit intake migration approval, exact existing owner/database/core v2 and absent target tables required';
 END IF;
END $$;
CREATE TABLE lifeos_platform.platform_intake_batch(
 owner_id text NOT NULL REFERENCES lifeos_platform.platform_user(id),id uuid NOT NULL,
 provider text NOT NULL CHECK(provider IN ('apple-calendar','xunji-training')),
 scope_id text NOT NULL CHECK(length(scope_id) BETWEEN 1 AND 128),
 snapshot_digest text NOT NULL CHECK(snapshot_digest ~ '^[0-9a-f]{64}$'),
 captured_at timestamptz NOT NULL,window_from date,window_through date,
 original jsonb NOT NULL CHECK(jsonb_typeof(original)='object' AND octet_length(original::text)<=16777216),
 coverage jsonb NOT NULL CHECK(jsonb_typeof(coverage)='object'),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,id),UNIQUE(owner_id,provider,scope_id,snapshot_digest),
 UNIQUE(owner_id,id,provider,scope_id),
 CHECK((window_from IS NULL AND window_through IS NULL) OR (window_from IS NOT NULL AND window_through IS NOT NULL AND window_through>=window_from))
);
CREATE TABLE lifeos_platform.platform_intake_item(
 owner_id text NOT NULL,id uuid NOT NULL,batch_id uuid NOT NULL,
 provider text NOT NULL CHECK(provider IN ('apple-calendar','xunji-training')),
 scope_id text NOT NULL CHECK(length(scope_id) BETWEEN 1 AND 128),
 identity_digest text NOT NULL CHECK(identity_digest ~ '^[0-9a-f]{64}$'),
 source_key text NOT NULL CHECK(length(source_key) BETWEEN 1 AND 4096),
 source_id text NOT NULL CHECK(length(source_id) BETWEEN 1 AND 1024),
 source_version text CHECK(source_version IS NULL OR length(source_version) BETWEEN 1 AND 128),
 source_revision jsonb NOT NULL CHECK((jsonb_typeof(source_revision)='object' AND source_revision->>'kind' IN ('source','content-digest') AND jsonb_typeof(source_revision->'value')='string' AND length(source_revision->>'value') BETWEEN 1 AND 512) IS TRUE),
 content_digest text NOT NULL CHECK(content_digest ~ '^[0-9a-f]{64}$'),
 original_pointer text NOT NULL,
 derived jsonb NOT NULL CHECK(jsonb_typeof(derived)='object'),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,id),UNIQUE(owner_id,provider,scope_id,identity_digest),UNIQUE(owner_id,batch_id,original_pointer),
 FOREIGN KEY(owner_id,batch_id,provider,scope_id) REFERENCES lifeos_platform.platform_intake_batch(owner_id,id,provider,scope_id),
 CHECK((provider='apple-calendar' AND original_pointer ~ '^/events/[0-9]+$') OR (provider='xunji-training' AND original_pointer ~ '^/days/[0-9]+/response/res/trains/[0-9]+$')),
 CHECK(source_revision->>'kind'<>'content-digest' OR source_revision->>'value'=content_digest)
);
CREATE TABLE lifeos_platform.platform_intake_command(
 owner_id text NOT NULL REFERENCES lifeos_platform.platform_user(id),command_key text NOT NULL CHECK(command_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$'),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),response jsonb NOT NULL CHECK(jsonb_typeof(response)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,command_key)
);
ALTER TABLE lifeos_platform.platform_intake_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.platform_intake_batch FORCE ROW LEVEL SECURITY;
CREATE POLICY intake_batch_owner ON lifeos_platform.platform_intake_batch USING(owner_id=current_setting('lifeos.owner_id',true)) WITH CHECK(owner_id=current_setting('lifeos.owner_id',true));
ALTER TABLE lifeos_platform.platform_intake_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.platform_intake_item FORCE ROW LEVEL SECURITY;
CREATE POLICY intake_item_owner ON lifeos_platform.platform_intake_item USING(owner_id=current_setting('lifeos.owner_id',true)) WITH CHECK(owner_id=current_setting('lifeos.owner_id',true));
ALTER TABLE lifeos_platform.platform_intake_command ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.platform_intake_command FORCE ROW LEVEL SECURITY;
CREATE POLICY intake_command_owner ON lifeos_platform.platform_intake_command USING(owner_id=current_setting('lifeos.owner_id',true)) WITH CHECK(owner_id=current_setting('lifeos.owner_id',true));
REVOKE ALL ON lifeos_platform.platform_intake_batch,lifeos_platform.platform_intake_item,lifeos_platform.platform_intake_command FROM PUBLIC;
REVOKE ALL ON lifeos_platform.platform_intake_batch,lifeos_platform.platform_intake_item,lifeos_platform.platform_intake_command FROM lifeos_platform_candidate_runtime;
GRANT SELECT,INSERT ON lifeos_platform.platform_intake_batch,lifeos_platform.platform_intake_item,lifeos_platform.platform_intake_command TO lifeos_platform_candidate_runtime;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='lifeos_platform' AND c.relname IN ('platform_intake_batch','platform_intake_item','platform_intake_command')
  AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
   OR NOT has_table_privilege('lifeos_platform_candidate_runtime',c.oid,'SELECT')
   OR NOT has_table_privilege('lifeos_platform_candidate_runtime',c.oid,'INSERT')
   OR has_table_privilege('lifeos_platform_candidate_runtime',c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR has_any_column_privilege('lifeos_platform_candidate_runtime',c.oid,'UPDATE,REFERENCES')))
 OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
  WHERE n.nspname='lifeos_platform' AND c.relname IN ('platform_intake_batch','platform_intake_item','platform_intake_command')
   AND a.grantee NOT IN (c.relowner,(SELECT oid FROM pg_roles WHERE rolname='lifeos_platform_candidate_runtime')))
 THEN RAISE EXCEPTION 'Intake effective ACL/RLS mismatch; transaction aborted';END IF;
END $$;
-- No UPDATE/DELETE/TRUNCATE/DDL, existing table changes, roles or credentials.
COMMIT;
