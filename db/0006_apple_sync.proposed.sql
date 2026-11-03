-- PROPOSED ONLY: operator/disposable synthetic setup, never startup/API DDL.
-- No runtime activation or real data migration is authorized by this file.
BEGIN;
DO $$ BEGIN
 IF current_setting('lifeos.apple_sync_migration_approved',true) IS DISTINCT FROM '1'
  OR current_database()<>'lifeos_platform_test_local'
  OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap')
  OR (SELECT version FROM lifeos_platform.platform_meta) IS DISTINCT FROM 2
  OR (SELECT version FROM lifeos_platform.platform_calendar_meta) IS DISTINCT FROM 1 THEN
  RAISE EXCEPTION 'Explicit sync migration approval, isolated database, migration owner, core v2 and calendar v1 required';
 END IF;
END $$;
CREATE TABLE lifeos_platform.platform_sync_meta(version integer PRIMARY KEY CHECK(version=1),delivery_shape_digest text NOT NULL CHECK(delivery_shape_digest ~ '^[0-9a-f]{64}$'));
-- This row is locked before business rows and held until commit. Allocation is transactional.
CREATE TABLE lifeos_platform.platform_sync_cursor(
 owner_id text NOT NULL REFERENCES lifeos_platform.platform_user(id),space_id text NOT NULL CHECK(length(space_id) BETWEEN 1 AND 128),
 published numeric NOT NULL DEFAULT 0 CHECK(published>=0 AND published=trunc(published) AND published::text ~ '^(0|[1-9][0-9]*)$'),PRIMARY KEY(owner_id,space_id)
);
CREATE TABLE lifeos_platform.platform_sync_lease(
 owner_id text NOT NULL,space_id text NOT NULL,bridge_id text NOT NULL CHECK(length(bridge_id) BETWEEN 1 AND 128),identity_epoch text NOT NULL CHECK(length(identity_epoch) BETWEEN 1 AND 128),
 fence numeric NOT NULL CHECK(fence>=1 AND fence=trunc(fence) AND fence::text ~ '^(0|[1-9][0-9]*)$'),expires_at timestamptz NOT NULL,
 ack_cursor numeric NOT NULL DEFAULT 0 CHECK(ack_cursor>=0 AND ack_cursor=trunc(ack_cursor) AND ack_cursor::text ~ '^(0|[1-9][0-9]*)$'),
 -- SQL bounds the persisted shape; shared delivery-domain performs full protocol validation.
 active_delivery jsonb,
 CONSTRAINT sync_delivery_shape CHECK(active_delivery IS NULL OR ((
  jsonb_typeof(active_delivery)='object' AND octet_length(active_delivery::text)<=262144
  AND active_delivery ?& ARRAY['format','version','attemptId','binding','phase','cursor','canonicalRevision','intent','intentHash','preparedMapping','claim','receipt','retirement']
  AND active_delivery - ARRAY['format','version','attemptId','binding','phase','cursor','canonicalRevision','intent','intentHash','preparedMapping','claim','receipt','retirement']='{}'::jsonb
  AND active_delivery->>'format'='lifeos.apple-sync.delivery.v1'
  AND jsonb_typeof(active_delivery->'version')='string' AND active_delivery->>'version' ~ '^[1-9][0-9]{0,39}$'
  AND active_delivery->>'cursor' ~ '^[1-9][0-9]{0,39}$'
  AND active_delivery->>'phase' IN ('issued','claimed','readback-verified','acknowledged','retired-unapplied')
  AND jsonb_typeof(active_delivery->'binding')='object'
  AND active_delivery->'binding'->>'ownerId'=owner_id AND active_delivery->'binding'->>'spaceId'=space_id
  AND active_delivery->'binding'->>'bridgeId'=bridge_id AND active_delivery->'binding'->>'identityEpoch'=identity_epoch
 ) IS TRUE)),
 PRIMARY KEY(owner_id,space_id),FOREIGN KEY(owner_id,space_id) REFERENCES lifeos_platform.platform_sync_cursor(owner_id,space_id)
);
-- Trusted migration attests the actual parsed guard, not a guessed deparser string.
-- Runtime can only SELECT this metadata. PG upgrades/logical restores that reparse
-- the guard may change its node tree: fail closed and requalify under operator approval.
INSERT INTO lifeos_platform.platform_sync_meta(version,delivery_shape_digest)
 VALUES(1,(SELECT encode(sha256(convert_to(c.conbin::text||':'||c.conkey::text,'UTF8')),'hex')
  FROM pg_constraint c WHERE c.conrelid='lifeos_platform.platform_sync_lease'::regclass
  AND c.conname='sync_delivery_shape' AND c.contype='c' AND c.convalidated));
CREATE TABLE lifeos_platform.platform_sync_outbox(
 owner_id text NOT NULL,space_id text NOT NULL,cursor numeric NOT NULL CHECK(cursor>=1 AND cursor=trunc(cursor) AND cursor::text ~ '^(0|[1-9][0-9]*)$'),
 kind text NOT NULL CHECK(kind IN ('todo','calendar')),entity_id uuid NOT NULL,source_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),
 command_key text NOT NULL CHECK(command_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$'),snapshot jsonb NOT NULL,
 PRIMARY KEY(owner_id,space_id,cursor),UNIQUE(owner_id,space_id,kind,entity_id,revision),
 FOREIGN KEY(owner_id,space_id) REFERENCES lifeos_platform.platform_sync_cursor(owner_id,space_id),
 FOREIGN KEY(owner_id,source_id) REFERENCES lifeos_platform.platform_source(owner_id,id),
 todo_id uuid GENERATED ALWAYS AS (CASE WHEN kind='todo' THEN entity_id END) STORED,
 calendar_id uuid GENERATED ALWAYS AS (CASE WHEN kind='calendar' THEN entity_id END) STORED,
 FOREIGN KEY(owner_id,todo_id) REFERENCES lifeos_platform.platform_record(owner_id,id),
 FOREIGN KEY(owner_id,calendar_id) REFERENCES lifeos_platform.platform_calendar_event(owner_id,id),
 CHECK((jsonb_typeof(snapshot)='object' AND snapshot->>'ownerId'=owner_id AND snapshot->>'id'=entity_id::text AND snapshot->'source'->>'id'=source_id::text AND (snapshot->>'revision')::integer=revision) IS TRUE)
);
CREATE TABLE lifeos_platform.platform_sync_mapping(
 owner_id text NOT NULL,space_id text NOT NULL,bridge_id text NOT NULL CHECK(length(bridge_id) BETWEEN 1 AND 128),id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('todo','calendar')),entity_id uuid NOT NULL,source_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),business_revision integer NOT NULL CHECK(business_revision>0),
 native_identity jsonb NOT NULL CHECK(jsonb_typeof(native_identity)='object'),baseline jsonb NOT NULL CHECK(jsonb_typeof(baseline)='object'),
 native_hash text NOT NULL CHECK(native_hash ~ '^[0-9a-f]{64}$'),status text NOT NULL CHECK(status IN ('active','conflict','missing')),evidence jsonb NOT NULL,
 PRIMARY KEY(owner_id,space_id,id),UNIQUE(owner_id,space_id,bridge_id,kind,entity_id),
 FOREIGN KEY(owner_id,space_id) REFERENCES lifeos_platform.platform_sync_cursor(owner_id,space_id),FOREIGN KEY(owner_id,source_id) REFERENCES lifeos_platform.platform_source(owner_id,id),
 todo_id uuid GENERATED ALWAYS AS (CASE WHEN kind='todo' THEN entity_id END) STORED,
 calendar_id uuid GENERATED ALWAYS AS (CASE WHEN kind='calendar' THEN entity_id END) STORED,
 FOREIGN KEY(owner_id,todo_id) REFERENCES lifeos_platform.platform_record(owner_id,id),
 FOREIGN KEY(owner_id,calendar_id) REFERENCES lifeos_platform.platform_calendar_event(owner_id,id)
);
CREATE TABLE lifeos_platform.platform_sync_command(
 owner_id text NOT NULL,space_id text NOT NULL,bridge_id text NOT NULL,identity_epoch text NOT NULL,
 command_key text NOT NULL CHECK(command_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$'),digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),result jsonb NOT NULL,
 PRIMARY KEY(owner_id,space_id,bridge_id,identity_epoch,command_key),FOREIGN KEY(owner_id,space_id) REFERENCES lifeos_platform.platform_sync_cursor(owner_id,space_id)
);
CREATE TABLE lifeos_platform.platform_sync_conflict(
 owner_id text NOT NULL,space_id text NOT NULL,bridge_id text NOT NULL,id uuid NOT NULL,mapping_id uuid,
 kind text NOT NULL CHECK(length(kind) BETWEEN 1 AND 128),evidence jsonb NOT NULL,created_at timestamptz NOT NULL,
 PRIMARY KEY(owner_id,space_id,id),FOREIGN KEY(owner_id,space_id) REFERENCES lifeos_platform.platform_sync_cursor(owner_id,space_id),
 FOREIGN KEY(owner_id,space_id,mapping_id) REFERENCES lifeos_platform.platform_sync_mapping(owner_id,space_id,id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['platform_sync_cursor','platform_sync_lease','platform_sync_outbox','platform_sync_mapping','platform_sync_command','platform_sync_conflict'] LOOP
  EXECUTE format('ALTER TABLE lifeos_platform.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE lifeos_platform.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY sync_owner ON lifeos_platform.%I USING(owner_id=current_setting(''lifeos.owner_id'',true)) WITH CHECK(owner_id=current_setting(''lifeos.owner_id'',true))',t);
  EXECUTE format('REVOKE ALL ON lifeos_platform.%I FROM PUBLIC,lifeos_platform_candidate_runtime,lifeos_platform_candidate_bootstrap',t);
  EXECUTE format('GRANT SELECT,INSERT ON lifeos_platform.%I TO lifeos_platform_candidate_runtime',t);
 END LOOP;
END $$;
REVOKE ALL ON lifeos_platform.platform_sync_meta FROM PUBLIC,lifeos_platform_candidate_runtime,lifeos_platform_candidate_bootstrap;
GRANT SELECT ON lifeos_platform.platform_sync_meta TO lifeos_platform_candidate_runtime;
GRANT UPDATE(published) ON lifeos_platform.platform_sync_cursor TO lifeos_platform_candidate_runtime;
GRANT UPDATE(bridge_id,identity_epoch,fence,expires_at,ack_cursor,active_delivery) ON lifeos_platform.platform_sync_lease TO lifeos_platform_candidate_runtime;
GRANT UPDATE(version,business_revision,native_identity,baseline,native_hash,status,evidence) ON lifeos_platform.platform_sync_mapping TO lifeos_platform_candidate_runtime;
COMMIT;
