-- PROPOSED ONLY. Never run by build/start/API. Exact isolated test DB only.
-- Additive extension; core schema stays2, so old review code can be restored without deleting this data.
-- No new roles, credentials, users or business records. Existing runtime receives only this table's DML.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'lifeos_platform_test_local' OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap') OR (SELECT version FROM lifeos_platform.platform_meta)<>2 THEN
  RAISE EXCEPTION 'Approved migration owner, exact isolated database and core schema2 required';
 END IF;
END $$;
CREATE TABLE lifeos_platform.platform_ai_meta(version integer PRIMARY KEY CHECK(version=1));
INSERT INTO lifeos_platform.platform_ai_meta(version) VALUES(1);
CREATE TABLE lifeos_platform.platform_ai_settings(
 owner_id text PRIMARY KEY REFERENCES lifeos_platform.platform_user(id),
 revision integer NOT NULL CHECK(revision BETWEEN 1 AND 2147483646),
 payload jsonb NOT NULL,
 CHECK((jsonb_typeof(payload)='object' AND payload->>'ownerId'=owner_id AND (payload->>'revision')::integer=revision
  AND payload ?& ARRAY['ownerId','revision','materialRevision','config','secret','enabled','testState','testedMaterialRevision','testMode','testStartedAt','testedAt','updatedAt']
  AND payload-ARRAY['ownerId','revision','materialRevision','config','secret','enabled','testState','testedMaterialRevision','testMode','testStartedAt','testedAt','updatedAt']='{}'::jsonb
  AND (payload->>'materialRevision')::integer BETWEEN 1 AND 2147483646
  AND jsonb_typeof(payload->'config')='object' AND payload->'config'->>'provider'='volcengine-ark'
  AND payload->'config'->>'baseURL'='https://ark.cn-beijing.volces.com/api/v3' AND payload->'config'->>'dataScope'='current-message-only'
  AND (payload->'config')-ARRAY['provider','baseURL','model','dataScope','monthlyBudgetMinor']='{}'::jsonb
  AND jsonb_typeof(payload->'enabled')='boolean' AND payload->>'testState' IN ('never','pending','passed','failed')
  AND (payload->'testMode'='null'::jsonb OR payload->>'testMode' IN ('synthetic-sdk-test','approved-live'))
  AND (payload->'secret'='null'::jsonb OR (jsonb_typeof(payload->'secret')='object'
   AND payload->'secret' ?& ARRAY['version','keyId','iv','tag','ciphertext']
   AND (payload->'secret')-ARRAY['version','keyId','iv','tag','ciphertext']='{}'::jsonb
   AND payload->'secret'->>'version'='1' AND jsonb_typeof(payload->'secret'->'ciphertext')='string'))
  AND (payload->>'enabled'='false' OR (payload->'secret'<>'null'::jsonb AND payload->>'testState'='passed' AND payload->>'testedMaterialRevision'=payload->>'materialRevision'))
 ) IS TRUE)
);
ALTER TABLE lifeos_platform.platform_ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.platform_ai_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_settings_owner ON lifeos_platform.platform_ai_settings USING(owner_id=current_setting('lifeos.owner_id',true)) WITH CHECK(owner_id=current_setting('lifeos.owner_id',true));
REVOKE ALL ON lifeos_platform.platform_ai_settings,lifeos_platform.platform_ai_meta FROM PUBLIC;
GRANT SELECT ON lifeos_platform.platform_ai_meta TO lifeos_platform_candidate_runtime;
GRANT SELECT,INSERT,UPDATE ON lifeos_platform.platform_ai_settings TO lifeos_platform_candidate_runtime;
COMMIT;
