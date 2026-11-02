-- PROPOSED ONLY. Never run from build/start/API/tests. No server DDL is authorized.
-- Additive extension in the existing isolated PostgreSQL database; core meta remains v2.
-- A separately approved operator must explicitly set lifeos.calendar_migration_approved=1.
-- No new database, user, role, credential, Apple access or imported business records.
BEGIN;
DO $$ BEGIN
 IF current_setting('lifeos.calendar_migration_approved',true) IS DISTINCT FROM '1'
  OR current_database()<>'lifeos_platform_test_local'
  OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap')
  OR (SELECT version FROM lifeos_platform.platform_meta) IS DISTINCT FROM 2 THEN
  RAISE EXCEPTION 'Explicit calendar migration approval, exact isolated database, migration owner and core v2 required';
 END IF;
END $$;
CREATE TABLE lifeos_platform.platform_calendar_meta(version integer PRIMARY KEY CHECK(version=1));
INSERT INTO lifeos_platform.platform_calendar_meta(version) VALUES(1);
CREATE TABLE lifeos_platform.platform_calendar_event(
 owner_id text NOT NULL REFERENCES lifeos_platform.platform_user(id),id uuid NOT NULL,source_id uuid NOT NULL,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 240),notes text NOT NULL CHECK(length(notes)<=16384),
 schedule_kind text NOT NULL CHECK(schedule_kind IN ('all-day','timed')),
 start_date date,end_date date,start_at timestamptz,end_at timestamptz,time_zone text,
 status text NOT NULL CHECK(status IN ('planned','cancelled')),revision integer NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
 created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
 PRIMARY KEY(owner_id,id),UNIQUE(owner_id,source_id),
 FOREIGN KEY(owner_id,source_id) REFERENCES lifeos_platform.platform_source(owner_id,id),
 CHECK((CASE WHEN schedule_kind='all-day' THEN
  start_date IS NOT NULL AND end_date IS NOT NULL AND start_date>=DATE '0001-01-01' AND end_date<=DATE '9999-12-31' AND end_date>start_date
  AND start_at IS NULL AND end_at IS NULL AND time_zone IS NULL
 ELSE start_date IS NULL AND end_date IS NULL AND start_at IS NOT NULL AND end_at IS NOT NULL
  AND start_at>=TIMESTAMPTZ '0001-01-01 00:00:00+00' AND end_at<TIMESTAMPTZ '10000-01-01 00:00:00+00' AND end_at>start_at
  AND time_zone IS NOT NULL AND length(time_zone) BETWEEN 1 AND 100
  AND (time_zone='UTC' OR time_zone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+$' OR (time_zone ~ '^[+-]((0[0-9]|1[0-3]):[0-5][0-9]|14:00)$' AND time_zone<>'-00:00')) END) IS TRUE)
);
CREATE INDEX calendar_event_owner_date_idx ON lifeos_platform.platform_calendar_event(owner_id,start_date,start_at);
CREATE TABLE lifeos_platform.platform_calendar_history(
 owner_id text NOT NULL,event_id uuid NOT NULL,revision integer NOT NULL CHECK(revision BETWEEN 1 AND 2147483647),
 raw jsonb NOT NULL CHECK(jsonb_typeof(raw)='object'),snapshot jsonb NOT NULL,created_at timestamptz NOT NULL,
 PRIMARY KEY(owner_id,event_id,revision),FOREIGN KEY(owner_id,event_id) REFERENCES lifeos_platform.platform_calendar_event(owner_id,id),
 CHECK((jsonb_typeof(snapshot)='object' AND snapshot->>'ownerId'=owner_id AND snapshot->>'id'=event_id::text AND (snapshot->>'revision')::integer=revision AND snapshot->>'status' IN ('planned','cancelled')) IS TRUE)
);
CREATE TABLE lifeos_platform.platform_calendar_command(
 owner_id text NOT NULL REFERENCES lifeos_platform.platform_user(id),command_key text NOT NULL CHECK(command_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$'),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),response jsonb NOT NULL CHECK(jsonb_typeof(response)='object'),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_id,command_key)
);
ALTER TABLE lifeos_platform.platform_calendar_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.platform_calendar_event FORCE ROW LEVEL SECURITY;
CREATE POLICY calendar_event_owner ON lifeos_platform.platform_calendar_event USING(owner_id=current_setting('lifeos.owner_id',true)) WITH CHECK(owner_id=current_setting('lifeos.owner_id',true));
ALTER TABLE lifeos_platform.platform_calendar_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.platform_calendar_history FORCE ROW LEVEL SECURITY;
CREATE POLICY calendar_history_owner ON lifeos_platform.platform_calendar_history USING(owner_id=current_setting('lifeos.owner_id',true)) WITH CHECK(owner_id=current_setting('lifeos.owner_id',true));
ALTER TABLE lifeos_platform.platform_calendar_command ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.platform_calendar_command FORCE ROW LEVEL SECURITY;
CREATE POLICY calendar_command_owner ON lifeos_platform.platform_calendar_command USING(owner_id=current_setting('lifeos.owner_id',true)) WITH CHECK(owner_id=current_setting('lifeos.owner_id',true));
REVOKE ALL ON lifeos_platform.platform_calendar_meta,lifeos_platform.platform_calendar_event,lifeos_platform.platform_calendar_history,lifeos_platform.platform_calendar_command FROM PUBLIC;
GRANT SELECT ON lifeos_platform.platform_calendar_meta TO lifeos_platform_candidate_runtime;
GRANT SELECT,INSERT ON lifeos_platform.platform_calendar_event,lifeos_platform.platform_calendar_history,lifeos_platform.platform_calendar_command TO lifeos_platform_candidate_runtime;
GRANT UPDATE(title,notes,schedule_kind,start_date,end_date,start_at,end_at,time_zone,status,revision,updated_at) ON lifeos_platform.platform_calendar_event TO lifeos_platform_candidate_runtime;
-- Existing SELECT/INSERT-only platform_source grants and owner policy are reused unchanged.
-- No DELETE/TRUNCATE, source/history overwrite, owner/source-id edits, or schema creation granted.
COMMIT;
