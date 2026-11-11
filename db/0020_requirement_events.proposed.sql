-- PROPOSED ONLY. No production execution, role creation, key scopes or background activation.
-- Root must separately qualify exact database/owner, backup, restricted roles and rollback.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
DO $$ BEGIN
 IF current_setting('lifeos.requirement_events_migration_approved',true) IS DISTINCT FROM 'transaction-outbox-v1'
  OR current_setting('lifeos.agent_expected_database',true) IS DISTINCT FROM current_database()
  OR current_setting('lifeos.agent_expected_owner',true) IS DISTINCT FROM (SELECT owner_id FROM lifeos_agent.key_management_binding)
  OR current_setting('lifeos.agent_expected_space',true) IS DISTINCT FROM (SELECT space_id FROM lifeos_agent.key_management_binding)
  OR (SELECT count(*) FROM lifeos_agent.key_management_binding)<>1
  OR (SELECT version FROM lifeos_platform.platform_meta) IS DISTINCT FROM 2
  OR to_regclass('lifeos_platform.requirement_work') IS NOT NULL
  OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap','lifeos_agent_verifier','lifeos_agent_key_manager')
  OR (SELECT relowner FROM pg_class WHERE oid='lifeos_platform.platform_record'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
  OR to_regprocedure('lifeos_agent.assert_business_grant(text,text,text,text[])') IS NULL
 THEN RAISE EXCEPTION 'Explicit exact-target migration approval and restricted business prerequisites required';END IF;
END $$;
CREATE TABLE lifeos_platform.requirement_work(
 owner_id text NOT NULL REFERENCES lifeos_platform.platform_user(id),space_id text NOT NULL,
 requirement_id text NOT NULL,source_id uuid NOT NULL,record_revision integer NOT NULL CHECK(record_revision>0),
 work_digest text NOT NULL CHECK(work_digest ~ '^[a-f0-9]{64}$'),
 dispatch_state text NOT NULL CHECK(dispatch_state IN ('candidate','ready','running','blocked','awaiting_review','done','paused','cancelled')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),lease_fence bigint NOT NULL DEFAULT 0 CHECK(lease_fence>=0),
 lease_id uuid,lease_holder text,lease_grant_id text,lease_expires_at timestamptz,
 PRIMARY KEY(owner_id,space_id,requirement_id),
 FOREIGN KEY(owner_id,source_id) REFERENCES lifeos_platform.platform_source(owner_id,id),
 CHECK((dispatch_state='running' AND lease_id IS NOT NULL AND lease_holder IS NOT NULL AND lease_grant_id IS NOT NULL AND lease_expires_at IS NOT NULL)
   OR (dispatch_state<>'running' AND lease_id IS NULL AND lease_holder IS NULL AND lease_grant_id IS NULL AND lease_expires_at IS NULL))
);
CREATE TABLE lifeos_platform.requirement_event_outbox(
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,owner_id text NOT NULL,space_id text NOT NULL,
 requirement_id text NOT NULL,source_id uuid NOT NULL,record_revision integer NOT NULL,work_digest text NOT NULL,dispatch_state text NOT NULL,
 FOREIGN KEY(owner_id,space_id,requirement_id) REFERENCES lifeos_platform.requirement_work(owner_id,space_id,requirement_id)
);
CREATE INDEX requirement_event_owner_cursor ON lifeos_platform.requirement_event_outbox(owner_id,space_id,event_id);
CREATE TABLE lifeos_platform.requirement_claim_command(
 owner_id text NOT NULL,space_id text NOT NULL,grant_id text NOT NULL,
 command_key text NOT NULL CHECK(command_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$'),digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),response jsonb NOT NULL,
 PRIMARY KEY(owner_id,space_id,grant_id,command_key)
);
ALTER TABLE lifeos_platform.requirement_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.requirement_work FORCE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.requirement_event_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.requirement_event_outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.requirement_claim_command ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.requirement_claim_command FORCE ROW LEVEL SECURITY;
CREATE POLICY requirement_work_owner ON lifeos_platform.requirement_work USING(owner_id=current_setting('lifeos.owner_id',true) AND space_id=current_setting('lifeos.requirement_event_space',true)) WITH CHECK(owner_id=current_setting('lifeos.owner_id',true) AND space_id=current_setting('lifeos.requirement_event_space',true));
CREATE POLICY requirement_event_owner ON lifeos_platform.requirement_event_outbox USING(owner_id=current_setting('lifeos.owner_id',true) AND space_id=current_setting('lifeos.requirement_event_space',true)) WITH CHECK(owner_id=current_setting('lifeos.owner_id',true) AND space_id=current_setting('lifeos.requirement_event_space',true));
CREATE POLICY requirement_claim_owner ON lifeos_platform.requirement_claim_command USING(owner_id=current_setting('lifeos.owner_id',true) AND space_id=current_setting('lifeos.requirement_event_space',true)) WITH CHECK(owner_id=current_setting('lifeos.owner_id',true) AND space_id=current_setting('lifeos.requirement_event_space',true));
REVOKE ALL ON lifeos_platform.requirement_work,lifeos_platform.requirement_event_outbox,lifeos_platform.requirement_claim_command FROM PUBLIC;
REVOKE ALL ON SEQUENCE lifeos_platform.requirement_event_outbox_event_id_seq FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON lifeos_platform.requirement_work TO lifeos_platform_candidate_runtime;
GRANT SELECT,INSERT,DELETE ON lifeos_platform.requirement_event_outbox TO lifeos_platform_candidate_runtime;
GRANT SELECT,INSERT ON lifeos_platform.requirement_claim_command TO lifeos_platform_candidate_runtime;
GRANT USAGE ON SEQUENCE lifeos_platform.requirement_event_outbox_event_id_seq TO lifeos_platform_candidate_runtime;

-- Invoker: uses the original restricted owner write transaction, never a second writer.
-- No backfill: existing/paused goals are NOT silently admitted by this migration.
CREATE FUNCTION lifeos_platform.capture_requirement_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE original jsonb;space text;rid text;wf text;wd text;prior lifeos_platform.requirement_work%ROWTYPE;state text;changed boolean;
BEGIN
 SELECT s.original INTO original FROM lifeos_platform.platform_source s WHERE s.owner_id=NEW.owner_id AND s.id=NEW.source_id;
 IF NEW.kind<>'inbox' OR original->>'marker' IS DISTINCT FROM 'personal-requirement-v2' OR original->>'schema' IS DISTINCT FROM '2' THEN RETURN NEW;END IF;
 space:=original->>'spaceId';rid:=NEW.draft->'requirement'->>'id';wf:=NEW.draft->'requirement'->'workflow'->>'state';
 IF space IS NULL OR rid IS NULL OR NEW.owner_id IS DISTINCT FROM current_setting('lifeos.owner_id',true) THEN RAISE EXCEPTION 'Invalid owner requirement event';END IF;
 PERFORM set_config('lifeos.requirement_event_space',space,true);
 -- Owner/space serialization spans sequence assignment THROUGH COMMIT. A cursor cannot skip an earlier uncommitted event.
 PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array('requirement-events-v1',NEW.owner_id,space)::text,0));
 SELECT * INTO prior FROM lifeos_platform.requirement_work WHERE owner_id=NEW.owner_id AND space_id=space AND requirement_id=rid FOR UPDATE;
 wd:=encode(sha256(convert_to(jsonb_build_array(NEW.source_id::text,NEW.draft->>'title',NEW.draft->>'text',NEW.draft->'requirement'->>'phaseId',NEW.draft->'requirement'->>'priority',NEW.draft->'requirement'->'plannedStartOn',NEW.draft->'requirement'->'plannedEndOn')::text,'UTF8')),'hex');
 changed:=prior.work_digest IS DISTINCT FROM wd;
 -- Only a new, explicitly planned owner ticket is admitted. Legacy edits/candidates do not auto-resume.
 state:=CASE WHEN prior.requirement_id IS NULL THEN CASE WHEN TG_OP='INSERT' AND wf='planned' THEN 'ready' ELSE 'candidate' END
   WHEN prior.dispatch_state IN ('paused','cancelled','candidate') THEN prior.dispatch_state
   WHEN changed THEN 'ready' ELSE prior.dispatch_state END;
 IF state NOT IN ('paused','cancelled','candidate') AND wf IN ('blocked','awaiting_review','done') THEN state:=wf;END IF;
 INSERT INTO lifeos_platform.requirement_work(owner_id,space_id,requirement_id,source_id,record_revision,work_digest,dispatch_state,attempts,lease_fence,lease_id,lease_holder,lease_grant_id,lease_expires_at)
 VALUES(NEW.owner_id,space,rid,NEW.source_id,NEW.revision,wd,state,CASE WHEN changed THEN 0 ELSE prior.attempts END,COALESCE(prior.lease_fence,0),
  CASE WHEN NOT changed AND state='running' THEN prior.lease_id END,CASE WHEN NOT changed AND state='running' THEN prior.lease_holder END,
  CASE WHEN NOT changed AND state='running' THEN prior.lease_grant_id END,CASE WHEN NOT changed AND state='running' THEN prior.lease_expires_at END)
 ON CONFLICT(owner_id,space_id,requirement_id) DO UPDATE SET source_id=EXCLUDED.source_id,record_revision=EXCLUDED.record_revision,work_digest=EXCLUDED.work_digest,dispatch_state=EXCLUDED.dispatch_state,attempts=EXCLUDED.attempts,lease_fence=EXCLUDED.lease_fence,lease_id=EXCLUDED.lease_id,lease_holder=EXCLUDED.lease_holder,lease_grant_id=EXCLUDED.lease_grant_id,lease_expires_at=EXCLUDED.lease_expires_at;
 IF changed OR prior.dispatch_state IS DISTINCT FROM state THEN
  INSERT INTO lifeos_platform.requirement_event_outbox(owner_id,space_id,requirement_id,source_id,record_revision,work_digest,dispatch_state) VALUES(NEW.owner_id,space,rid,NEW.source_id,NEW.revision,wd,state);
  DELETE FROM lifeos_platform.requirement_event_outbox WHERE owner_id=NEW.owner_id AND space_id=space AND event_id<(SELECT event_id FROM lifeos_platform.requirement_event_outbox WHERE owner_id=NEW.owner_id AND space_id=space ORDER BY event_id DESC OFFSET 999 LIMIT 1);
  PERFORM pg_notify('lifeos_requirement_events','');
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION lifeos_platform.capture_requirement_event() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lifeos_platform.capture_requirement_event() TO lifeos_platform_candidate_runtime;
CREATE TRIGGER requirement_event_after_write AFTER INSERT OR UPDATE ON lifeos_platform.platform_record FOR EACH ROW EXECUTE FUNCTION lifeos_platform.capture_requirement_event();
-- Optional all-business registration is disabled; this never changes a key or activates policy.
DO $$ BEGIN
 IF to_regclass('lifeos_agent.business_policy_operation') IS NOT NULL THEN
  INSERT INTO lifeos_agent.business_policy_operation(operation_id,required_scopes) VALUES
   ('streamRequirementEvents',ARRAY['requirements:read']),
   ('claimRequirementExecution',ARRAY['requirements:read','requirements:write']),
   ('updateRequirementExecution',ARRAY['requirements:read','requirements:write']);
 END IF;
END $$;
COMMIT;
