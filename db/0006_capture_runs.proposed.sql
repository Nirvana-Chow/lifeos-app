-- PROPOSED ONLY. Never run from build/start/API/tests. No DDL is authorized here.
-- Metadata-only capture run extension in the existing isolated PostgreSQL DB.
-- No prompt, input, model output, response body, key, header or error text column.
-- Digests are private metadata, not anonymization. Core meta remains v2.
-- A separately approved operator must set lifeos.capture_runs_migration_approved=1.
BEGIN;
DO $$ BEGIN
 IF current_setting('lifeos.capture_runs_migration_approved',true) IS DISTINCT FROM '1'
  OR current_database()<>'lifeos_platform_test_local'
  OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap')
  OR (SELECT version FROM lifeos_platform.platform_meta) IS DISTINCT FROM 2 THEN
  RAISE EXCEPTION 'Explicit capture run migration approval, exact isolated database, migration owner and core v2 required';
 END IF;
END $$;

CREATE TABLE lifeos_platform.platform_capture_run_meta(version integer PRIMARY KEY CHECK(version=1));
INSERT INTO lifeos_platform.platform_capture_run_meta(version) VALUES(1);
CREATE TABLE lifeos_platform.platform_capture_run(
 owner_id text NOT NULL REFERENCES lifeos_platform.platform_user(id),
 id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('todo','life')),
 adapter text NOT NULL CHECK(adapter IN ('manual','synthetic-fixture','ai')),
 source_hash text NOT NULL CHECK(source_hash ~ '^[0-9a-f]{64}$'),
 provenance jsonb,
 revision integer NOT NULL CHECK(revision BETWEEN 1 AND 2147483646),
 state text NOT NULL CHECK(state IN ('pending','ready','failed','cancelled','configuration-changed','confirmation-pending','confirmed')),
 created_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 confirmation_hash text CHECK(confirmation_hash IS NULL OR confirmation_hash ~ '^[0-9a-f]{64}$'),
 record jsonb,
 PRIMARY KEY(owner_id,id),
 CHECK(created_at>=TIMESTAMPTZ '0001-01-01 00:00:00+00' AND updated_at<TIMESTAMPTZ '10000-01-01 00:00:00+00' AND updated_at>=created_at),
 CHECK(state<>'pending' OR (revision=1 AND updated_at=created_at)),
 CHECK((state IN ('confirmation-pending','confirmed'))=(confirmation_hash IS NOT NULL)),
 CHECK((state='confirmed')=(record IS NOT NULL)),
 CHECK((CASE WHEN adapter='ai' THEN
  jsonb_typeof(provenance)='object'
  AND provenance ?& ARRAY['provider','model','configurationRevision','materialRevision','mode']
  AND provenance-ARRAY['provider','model','configurationRevision','materialRevision','mode']='{}'::jsonb
  AND provenance->>'provider'='volcengine-ark'
  AND jsonb_typeof(provenance->'model')='string' AND length(provenance->>'model') BETWEEN 1 AND 160 AND provenance->>'model' ~ '^[A-Za-z0-9_.:-]+$'
  AND jsonb_typeof(provenance->'configurationRevision')='number' AND provenance->>'configurationRevision' ~ '^[1-9][0-9]{0,9}$' AND (provenance->>'configurationRevision')::bigint BETWEEN 1 AND 2147483646
  AND jsonb_typeof(provenance->'materialRevision')='number' AND provenance->>'materialRevision' ~ '^[1-9][0-9]{0,9}$' AND (provenance->>'materialRevision')::bigint BETWEEN 1 AND 2147483646
  AND provenance->>'mode' IN ('synthetic-sdk-test','approved-live')
 ELSE provenance IS NULL END) IS TRUE),
 CHECK((CASE WHEN record IS NULL THEN true ELSE
  jsonb_typeof(record)='object'
  AND record ?& ARRAY['kind','id','sourceId','revision']
  AND record-ARRAY['kind','id','sourceId','revision']='{}'::jsonb
  AND record->>'kind'=CASE WHEN kind='todo' THEN 'todo' ELSE 'inbox' END
  AND jsonb_typeof(record->'id')='string' AND record->>'id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND jsonb_typeof(record->'sourceId')='string' AND record->>'sourceId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND record->'revision'='1'::jsonb END) IS TRUE)
);

ALTER TABLE lifeos_platform.platform_capture_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.platform_capture_run FORCE ROW LEVEL SECURITY;
CREATE POLICY capture_run_owner ON lifeos_platform.platform_capture_run USING(owner_id=current_setting('lifeos.owner_id',true)) WITH CHECK(owner_id=current_setting('lifeos.owner_id',true));
REVOKE ALL ON lifeos_platform.platform_capture_run_meta,lifeos_platform.platform_capture_run FROM PUBLIC,lifeos_platform_candidate_runtime;
GRANT SELECT ON lifeos_platform.platform_capture_run_meta TO lifeos_platform_candidate_runtime;
GRANT SELECT,INSERT ON lifeos_platform.platform_capture_run TO lifeos_platform_candidate_runtime;
GRANT UPDATE(revision,state,updated_at,confirmation_hash,record) ON lifeos_platform.platform_capture_run TO lifeos_platform_candidate_runtime;
-- owner/id/kind/adapter/source_hash/provenance/created_at are immutable to runtime.
-- No DELETE/TRUNCATE, source/history writes, schema changes or paid calls granted.
-- Missing or pending evidence never authorizes retrying a model automatically.
COMMIT;
