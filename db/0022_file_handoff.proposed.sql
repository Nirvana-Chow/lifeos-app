-- PROPOSED ONLY. No runtime flag, operation registration, grant change or cleanup.
-- Exact-target schema administration and rollback/readiness qualification are separate.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
DO $$ BEGIN
 IF current_setting('lifeos.file_handoff_migration_approved',true) IS DISTINCT FROM 'file-handoff-v1'
 OR current_setting('lifeos.agent_expected_database',true) IS DISTINCT FROM current_database()
 OR NOT EXISTS(SELECT 1 FROM lifeos_platform.platform_user WHERE id=current_setting('lifeos.agent_expected_owner',true))
 OR COALESCE(current_setting('lifeos.agent_expected_space',true),'') !~ '^[A-Za-z0-9_-]{8,80}$'
 OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap','lifeos_agent_issuer','lifeos_agent_verifier','lifeos_agent_key_manager')
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_platform.platform_record'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR to_regclass('lifeos_platform.file_handoff') IS NOT NULL
 OR to_regclass('lifeos_platform.file_handoff_command') IS NOT NULL
 THEN RAISE EXCEPTION 'Explicit exact-target file handoff migration by the platform owner required; existing state must be inspected, never overwritten';END IF;
END $$;
CREATE TABLE lifeos_platform.file_handoff(
 owner_id text NOT NULL,space_id text NOT NULL,id uuid NOT NULL,
 authority_ref text NOT NULL CHECK(length(authority_ref) BETWEEN 1 AND 256),command_key text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 source_file_id text NOT NULL CHECK(length(source_file_id) BETWEEN 1 AND 256),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 180 AND name !~ E'[\\/\n\r]'),mime_type text NOT NULL,
 target jsonb NOT NULL CHECK(jsonb_typeof(target)='object' AND target ?& ARRAY['id','sourceId','revision']),
 retention jsonb NOT NULL CHECK(jsonb_typeof(retention)='object' AND retention->>'kind' IN ('temporary','retained')),
 blob_key text,sha256 text,byte_length bigint,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),received_at timestamptz,
 acknowledgments jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(acknowledgments)='object'),
 transfer_token uuid,lease_until timestamptz,
 PRIMARY KEY(owner_id,space_id,id),UNIQUE(owner_id,space_id,authority_ref,command_key),
 CHECK((transfer_token IS NULL)=(lease_until IS NULL)),
 CHECK((state='pending' AND blob_key IS NULL AND sha256 IS NULL AND byte_length IS NULL AND received_at IS NULL)
  OR (state='ready' AND blob_key ~ '^[a-f0-9-]{36}\.[a-f0-9-]{36}\.blob$' AND sha256 ~ '^[a-f0-9]{64}$' AND byte_length BETWEEN 0 AND 33554432 AND received_at IS NOT NULL AND transfer_token IS NULL AND lease_until IS NULL))
);
CREATE TABLE lifeos_platform.file_handoff_command(
 owner_id text NOT NULL,space_id text NOT NULL,authority_ref text NOT NULL,command_key text NOT NULL,
 action text NOT NULL CHECK(action IN ('stage','ack')),intent_digest text NOT NULL CHECK(intent_digest ~ '^[a-f0-9]{64}$'),
 file_id uuid NOT NULL,response jsonb CHECK(response IS NULL OR jsonb_typeof(response)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_id,space_id,authority_ref,command_key),
 FOREIGN KEY(owner_id,space_id,file_id) REFERENCES lifeos_platform.file_handoff(owner_id,space_id,id),
 CHECK(action='stage' OR response IS NOT NULL)
);
CREATE FUNCTION lifeos_platform.file_handoff_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF (NEW.owner_id,NEW.space_id,NEW.id,NEW.authority_ref,NEW.command_key,NEW.source_file_id,NEW.name,NEW.mime_type,NEW.target,NEW.retention,NEW.created_at)
  IS DISTINCT FROM (OLD.owner_id,OLD.space_id,OLD.id,OLD.authority_ref,OLD.command_key,OLD.source_file_id,OLD.name,OLD.mime_type,OLD.target,OLD.retention,OLD.created_at)
 OR (OLD.state='ready' AND (NEW.state,NEW.blob_key,NEW.sha256,NEW.byte_length,NEW.received_at)
  IS DISTINCT FROM (OLD.state,OLD.blob_key,OLD.sha256,OLD.byte_length,OLD.received_at))
 THEN RAISE EXCEPTION 'File original identity and verified bytes are immutable';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER file_handoff_original BEFORE UPDATE ON lifeos_platform.file_handoff FOR EACH ROW EXECUTE FUNCTION lifeos_platform.file_handoff_immutable();
CREATE FUNCTION lifeos_platform.file_handoff_command_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF (NEW.owner_id,NEW.space_id,NEW.authority_ref,NEW.command_key,NEW.action,NEW.intent_digest,NEW.file_id,NEW.created_at)
  IS DISTINCT FROM (OLD.owner_id,OLD.space_id,OLD.authority_ref,OLD.command_key,OLD.action,OLD.intent_digest,OLD.file_id,OLD.created_at)
 OR OLD.response IS NOT NULL AND NEW.response IS DISTINCT FROM OLD.response
 THEN RAISE EXCEPTION 'Confirmed file command is immutable';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER file_handoff_receipt BEFORE UPDATE ON lifeos_platform.file_handoff_command FOR EACH ROW EXECUTE FUNCTION lifeos_platform.file_handoff_command_immutable();
ALTER TABLE lifeos_platform.file_handoff ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.file_handoff FORCE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.file_handoff_command ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.file_handoff_command FORCE ROW LEVEL SECURITY;
CREATE POLICY file_handoff_owner ON lifeos_platform.file_handoff USING(owner_id=current_setting('lifeos.file_owner',true) AND space_id=current_setting('lifeos.file_space',true)) WITH CHECK(owner_id=current_setting('lifeos.file_owner',true) AND space_id=current_setting('lifeos.file_space',true));
CREATE POLICY file_handoff_command_owner ON lifeos_platform.file_handoff_command USING(owner_id=current_setting('lifeos.file_owner',true) AND space_id=current_setting('lifeos.file_space',true)) WITH CHECK(owner_id=current_setting('lifeos.file_owner',true) AND space_id=current_setting('lifeos.file_space',true));
REVOKE ALL ON lifeos_platform.file_handoff,lifeos_platform.file_handoff_command FROM PUBLIC;
REVOKE ALL ON FUNCTION lifeos_platform.file_handoff_immutable(),lifeos_platform.file_handoff_command_immutable() FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON lifeos_platform.file_handoff,lifeos_platform.file_handoff_command TO lifeos_platform_candidate_runtime;
COMMIT;
-- No DELETE is granted: retention/ack is eligibility only, never automatic destruction.
-- Rollback is disable the new module and preserve tables/blobs/receipts for reconciliation.
