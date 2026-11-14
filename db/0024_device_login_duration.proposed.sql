-- PROPOSED ONLY. EXEC-SESSION-001 / LO-SEC-001 / LO-AUTH-001.
-- Never applied by build/start/routes. Separate migration approval and backup required.
-- Only owner-selected rolling sessions may renew; fixed deadlines and authentication age are immutable.
BEGIN;
DO $$ BEGIN
 IF current_setting('lifeos.device_sessions_approved',true) IS DISTINCT FROM 'native-device-v1'
 OR current_setting('lifeos.agent_expected_database',true) IS DISTINCT FROM current_database()
 OR current_database()!~'^lifeos_platform_test_[a-z0-9_]+$'
 OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap')
 OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='lifeos_platform.platform_session'::regclass AND pg_has_role(current_user,relowner,'USAGE'))
 THEN RAISE EXCEPTION 'Explicit isolated session migration approval and original owner required';END IF;
END $$;
CREATE FUNCTION lifeos_platform.valid_session_duration(mode text,seconds integer) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $$
 SELECT (mode='fixed' AND seconds BETWEEN 60 AND 31536000) OR (mode='rolling' AND seconds=34560000)
$$;
REVOKE ALL ON FUNCTION lifeos_platform.valid_session_duration(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lifeos_platform.valid_session_duration(text,integer) TO lifeos_platform_candidate_runtime;
ALTER TABLE lifeos_platform.platform_session
 ADD COLUMN "sessionDurationMode" text NOT NULL DEFAULT 'fixed',
 ADD COLUMN "sessionDurationSeconds" integer NOT NULL DEFAULT 1800,
 ADD CONSTRAINT platform_session_duration_policy CHECK (lifeos_platform.valid_session_duration("sessionDurationMode","sessionDurationSeconds"));
CREATE FUNCTION lifeos_platform.guard_session_duration() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW."expiresAt"<=NEW."createdAt" OR NEW."expiresAt">NEW."createdAt"+NEW."sessionDurationSeconds"*interval '1 second'
  THEN RAISE EXCEPTION 'Native cookie and server deadline policy required' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.token IS DISTINCT FROM OLD.token OR NEW."userId" IS DISTINCT FROM OLD."userId"
 OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW."sessionDurationMode" IS DISTINCT FROM OLD."sessionDurationMode"
 OR NEW."sessionDurationSeconds" IS DISTINCT FROM OLD."sessionDurationSeconds"
 OR OLD."sessionDurationMode"='fixed' AND NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
 THEN RAISE EXCEPTION 'Session identity, policy and fixed deadline are immutable' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION lifeos_platform.guard_session_duration() FROM PUBLIC;
CREATE TRIGGER platform_session_duration_guard BEFORE INSERT OR UPDATE ON lifeos_platform.platform_session
 FOR EACH ROW EXECUTE FUNCTION lifeos_platform.guard_session_duration();
-- Existing runtime session table grants already authorize these operations. No new roles or session-table privileges.
-- Exact original source: 0010_agent_key_management.proposed.sql sha256=12fc4c24e897c7aab19f893d0aa268b6876d89a28ddab0b5942b8799709b14c9
DO $patch$ DECLARE p pg_proc%ROWTYPE;BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('lifeos_agent.verify_management_session(text,text,text)');
 IF FOUND THEN
  IF NOT pg_has_role(current_user,p.proowner,'USAGE') OR NOT p.prosecdef THEN RAISE EXCEPTION 'Session freshness function owner mismatch';END IF;
  IF md5(p.prosrc)='d21da143975e04064d0d80ab5bbfa33a' THEN
   EXECUTE $definition$CREATE OR REPLACE FUNCTION lifeos_agent.verify_management_session(session_token text, owner_id text, owner_email text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT EXISTS (
  SELECT 1 FROM lifeos_platform.platform_session s
   JOIN lifeos_platform.platform_user u ON u.id=s."userId"
   JOIN lifeos_platform.platform_two_factor f ON f."userId"=u.id
   JOIN lifeos_agent.key_management_binding b ON b.owner_id=u.id
  WHERE s.token=session_token AND s."expiresAt">statement_timestamp() AND s."mfaVerified" IS TRUE AND s."createdAt"<=clock_timestamp() AND s."createdAt">clock_timestamp()-interval '30 minutes'
    AND u.id=owner_id AND lower(u.email)=owner_email AND u."twoFactorEnabled" IS TRUE
    AND f.verified IS TRUE
 )
$$;$definition$;
  ELSE RAISE EXCEPTION 'Unreviewed session freshness function source';END IF;
 END IF;
END $patch$;

-- Exact original source: 0011_business_agent_grants.proposed.sql sha256=c2e97da459b30c70fdaacce74ac956ffe4731b259035d6d3359c66116ac6c388
DO $patch$ DECLARE p pg_proc%ROWTYPE;BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('lifeos_agent.set_managed_grant_scopes(text,text,text,jsonb)');
 IF FOUND THEN
  IF NOT pg_has_role(current_user,p.proowner,'USAGE') OR NOT p.prosecdef THEN RAISE EXCEPTION 'Session freshness function owner mismatch';END IF;
  IF md5(p.prosrc)='6039cdb8b2d3b7feeab995cfdadbd3a9' THEN
   EXECUTE $definition$CREATE OR REPLACE FUNCTION lifeos_agent.set_managed_grant_scopes(session_token text,grant_id text,expected_digest text,new_permissions jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
 grant_row lifeos_agent.apikey%ROWTYPE;
 binding lifeos_agent.key_management_binding%ROWTYPE;
 before_digest text;
 after_digest text;
BEGIN
 IF NOT lifeos_agent.valid_business_permissions(new_permissions)
    OR expected_digest IS NULL OR expected_digest !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'Invalid grant scopes' USING ERRCODE='LG400';
 END IF;
 SELECT * INTO binding FROM lifeos_agent.key_management_binding;
 SELECT * INTO grant_row FROM lifeos_agent.apikey WHERE id=grant_id FOR UPDATE;
 IF NOT FOUND OR grant_row."configId"<>'default' OR grant_row."referenceId"<>binding.owner_id
    OR grant_row.metadata::jsonb->>'spaceId' IS DISTINCT FROM binding.space_id
    OR grant_row.enabled IS NOT TRUE OR grant_row."expiresAt" IS NULL OR grant_row."expiresAt"<=clock_timestamp() THEN
  RAISE EXCEPTION 'Grant unavailable' USING ERRCODE='LG403';
 END IF;
 -- This runs AFTER any lock wait and uses wall time, not statement start time.
 IF NOT EXISTS (
  SELECT 1 FROM lifeos_platform.platform_session s
   JOIN lifeos_platform.platform_user u ON u.id=s."userId"
   JOIN lifeos_platform.platform_two_factor f ON f."userId"=u.id
  WHERE s.token=session_token AND s."userId"=binding.owner_id AND s."expiresAt">clock_timestamp()
    AND s."mfaVerified" IS TRUE AND s."createdAt"<=clock_timestamp() AND s."createdAt">clock_timestamp()-interval '30 minutes' AND u."twoFactorEnabled" IS TRUE AND f.verified IS TRUE
 ) THEN RAISE EXCEPTION 'Owner MFA required' USING ERRCODE='LG401'; END IF;
 before_digest:=lifeos_agent.managed_grant_digest(grant_id);
 IF before_digest IS DISTINCT FROM expected_digest THEN
  RAISE EXCEPTION 'Grant changed' USING ERRCODE='LG409';
 END IF;
 IF grant_row.permissions::jsonb=new_permissions THEN RETURN before_digest; END IF;
 UPDATE lifeos_agent.apikey SET permissions=new_permissions::text,"updatedAt"=clock_timestamp() WHERE id=grant_id;
 after_digest:=lifeos_agent.managed_grant_digest(grant_id);
 INSERT INTO lifeos_agent.grant_scope_audit(owner_id,space_id,grant_id,before_permissions,after_permissions,before_digest,after_digest)
 VALUES(binding.owner_id,binding.space_id,grant_id,grant_row.permissions::jsonb,new_permissions,before_digest,after_digest);
 RETURN after_digest;
END
$$;$definition$;
 ELSIF md5(p.prosrc)='e91104cb6c10c4fc612c55f9664a85f5' THEN NULL; -- exact0016 delegation; hardened below
  ELSE RAISE EXCEPTION 'Unreviewed session freshness function source';END IF;
 END IF;
END $patch$;

-- Exact original source: 0016_all_personal_business_policy.proposed.sql sha256=879dca40aa0b129b37620cd80c89f3954611232c3f340cdb6e5484e9759d3c53
DO $patch$ DECLARE p pg_proc%ROWTYPE;BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('lifeos_agent.set_managed_business_grant(text,text,text,jsonb,text)');
 IF FOUND THEN
  IF NOT pg_has_role(current_user,p.proowner,'USAGE') OR NOT p.prosecdef THEN RAISE EXCEPTION 'Session freshness function owner mismatch';END IF;
  IF md5(p.prosrc)='85ea083ad65d226974ae19bbf6f599ed' THEN
   EXECUTE $definition$CREATE OR REPLACE FUNCTION lifeos_agent.set_managed_business_grant(session_token text,grant_id text,expected_digest text,new_permissions jsonb,new_policy text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE grant_row lifeos_agent.apikey%ROWTYPE; binding lifeos_agent.key_management_binding%ROWTYPE; before_digest text; after_digest text; old_policy text;
BEGIN
 IF NOT lifeos_agent.valid_business_permissions(new_permissions) OR expected_digest IS NULL OR expected_digest !~ '^[a-f0-9]{64}$'
 OR new_policy IS NOT NULL AND new_policy<>'all-personal-business-v1'
 OR new_policy IS NOT NULL AND NOT EXISTS(SELECT 1 FROM lifeos_agent.business_policy_control WHERE singleton AND enabled)
 THEN RAISE EXCEPTION 'Invalid business policy' USING ERRCODE='LG400'; END IF;
 SELECT * INTO binding FROM lifeos_agent.key_management_binding;
 SELECT * INTO grant_row FROM lifeos_agent.apikey WHERE id=grant_id FOR UPDATE;
 IF NOT FOUND OR grant_row."configId"<>'default' OR grant_row."referenceId" IS DISTINCT FROM binding.owner_id
 OR grant_row.metadata::jsonb->>'spaceId' IS DISTINCT FROM binding.space_id OR grant_row.enabled IS NOT TRUE
 OR grant_row."expiresAt" IS NULL OR grant_row."expiresAt"<=clock_timestamp()
 THEN RAISE EXCEPTION 'Grant unavailable' USING ERRCODE='LG403'; END IF;
 IF NOT EXISTS(SELECT 1 FROM lifeos_platform.platform_session s JOIN lifeos_platform.platform_user u ON u.id=s."userId"
 JOIN lifeos_platform.platform_two_factor f ON f."userId"=u.id WHERE s.token=session_token AND s."userId"=binding.owner_id
 AND s."expiresAt">clock_timestamp() AND s."mfaVerified" IS TRUE AND s."createdAt"<=clock_timestamp() AND s."createdAt">clock_timestamp()-interval '30 minutes' AND u."twoFactorEnabled" IS TRUE AND f.verified IS TRUE)
 THEN RAISE EXCEPTION 'Owner MFA required' USING ERRCODE='LG401'; END IF;
 before_digest:=lifeos_agent.current_managed_grant_digest(grant_id);
 IF before_digest IS DISTINCT FROM expected_digest THEN RAISE EXCEPTION 'Grant changed' USING ERRCODE='LG409'; END IF;
 old_policy:=grant_row.metadata::jsonb->>'businessDataPolicy';
 IF grant_row.permissions::jsonb=new_permissions AND old_policy IS NOT DISTINCT FROM new_policy THEN RETURN before_digest; END IF;
 UPDATE lifeos_agent.apikey SET permissions=new_permissions::text,
 metadata=CASE WHEN new_policy IS NULL THEN (metadata::jsonb-'businessDataPolicy')::text ELSE jsonb_set(metadata::jsonb,'{businessDataPolicy}',to_jsonb(new_policy))::text END,
 "updatedAt"=clock_timestamp() WHERE id=grant_id;
 after_digest:=lifeos_agent.current_managed_grant_digest(grant_id);
 INSERT INTO lifeos_agent.grant_scope_audit(owner_id,space_id,grant_id,before_permissions,after_permissions,before_digest,after_digest,before_policy,after_policy)
 VALUES(binding.owner_id,binding.space_id,grant_id,grant_row.permissions::jsonb,new_permissions,before_digest,after_digest,old_policy,new_policy);
 RETURN after_digest;
END
$$;$definition$;
  ELSE RAISE EXCEPTION 'Unreviewed session freshness function source';END IF;
 END IF;
END $patch$;

-- Exact original source: 0021_business_mcp_oauth.proposed.sql sha256=63944bed3b384ed00b51ec05aa126600c7ad28bd7fff9836e44019a37d61d4ee
DO $patch$ DECLARE p pg_proc%ROWTYPE;BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('lifeos_agent.oauth_business_owner_ready(text,text)');
 IF FOUND THEN
  IF NOT pg_has_role(current_user,p.proowner,'USAGE') OR NOT p.prosecdef THEN RAISE EXCEPTION 'Session freshness function owner mismatch';END IF;
  IF md5(p.prosrc)='876bbdc3249b34116603ddd7a694a728' THEN
   EXECUTE $definition$CREATE OR REPLACE FUNCTION lifeos_agent.oauth_business_owner_ready(session_id text,owner_id text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c lifeos_agent.oauth_business_control%ROWTYPE;s lifeos_platform.platform_session%ROWTYPE;u lifeos_platform.platform_user%ROWTYPE;f lifeos_platform.platform_two_factor%ROWTYPE; BEGIN
 SELECT * INTO c FROM lifeos_agent.oauth_business_control WHERE singleton;
 IF NOT c.enabled OR c.owner_id IS DISTINCT FROM owner_id THEN RETURN false;END IF;
 SELECT * INTO s FROM lifeos_platform.platform_session WHERE id=session_id FOR SHARE;
 IF NOT FOUND OR s."userId" IS DISTINCT FROM owner_id OR s."expiresAt"<=clock_timestamp() OR s."mfaVerified" IS NOT TRUE OR s."createdAt">clock_timestamp() OR s."createdAt"<=clock_timestamp()-interval '30 minutes' THEN RETURN false;END IF;
 SELECT * INTO u FROM lifeos_platform.platform_user WHERE id=owner_id FOR SHARE;
 IF NOT FOUND OR lower(u.email) IS DISTINCT FROM lower(c.owner_email) OR u."twoFactorEnabled" IS NOT TRUE THEN RETURN false;END IF;
 SELECT * INTO f FROM lifeos_platform.platform_two_factor WHERE "userId"=owner_id FOR SHARE;
 RETURN FOUND AND f.verified IS TRUE;
END $$;$definition$;
  ELSE RAISE EXCEPTION 'Unreviewed session freshness function source';END IF;
 END IF;
END $patch$;

-- Exact original source: 0023_file_handoff_permissions.proposed.sql sha256=6af0c3bcbe11e6ed6496bd4746200a6365fb2cbef27fd2868e784b8a9be9e62d
DO $patch$ DECLARE p pg_proc%ROWTYPE;BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('lifeos_agent.set_file_handoff_permission(text,text,text,integer,text[],text)');
 IF FOUND THEN
  IF NOT pg_has_role(current_user,p.proowner,'USAGE') OR NOT p.prosecdef THEN RAISE EXCEPTION 'Session freshness function owner mismatch';END IF;
  IF md5(p.prosrc)='0f9fc9fe6e2400fbbc03a593f17ce09e' THEN
   EXECUTE $definition$CREATE OR REPLACE FUNCTION lifeos_agent.set_file_handoff_permission(session_token text,g text,expected_digest text,expected_revision integer,new_scopes text[],new_consumer text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b lifeos_agent.key_management_binding%ROWTYPE;k lifeos_agent.apikey%ROWTYPE;before_state jsonb;after_state jsonb;actual_digest text;BEGIN
 SELECT * INTO b FROM lifeos_agent.key_management_binding;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('lifeos:personal-owner-maintenance:v1:'||b.owner_id,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('lifeos-business-mcp-oauth-v1',0));
 SELECT * INTO k FROM lifeos_agent.apikey WHERE id=g FOR UPDATE;
 IF NOT FOUND OR k.enabled IS NOT TRUE OR k."referenceId" IS DISTINCT FROM b.owner_id OR k.metadata::jsonb->>'spaceId' IS DISTINCT FROM b.space_id OR k."expiresAt" IS NULL OR k."expiresAt"<=clock_timestamp() THEN RAISE EXCEPTION 'Grant unavailable' USING ERRCODE='LG403';END IF;
 IF NOT EXISTS(SELECT 1 FROM lifeos_platform.platform_session x JOIN lifeos_platform.platform_user u ON u.id=x."userId" JOIN lifeos_platform.platform_two_factor f ON f."userId"=u.id WHERE x.token=session_token AND u.id=b.owner_id AND x."expiresAt">clock_timestamp() AND x."mfaVerified" IS TRUE AND x."createdAt"<=clock_timestamp() AND x."createdAt">clock_timestamp()-interval '30 minutes' AND u."twoFactorEnabled" IS TRUE AND f.verified IS TRUE) THEN RAISE EXCEPTION 'Owner MFA required' USING ERRCODE='LG401';END IF;
 actual_digest:=CASE WHEN k.metadata::jsonb ? 'businessDataPolicy' THEN lifeos_agent.current_managed_grant_digest(g) ELSE lifeos_agent.managed_grant_digest(g) END;
 IF actual_digest IS DISTINCT FROM expected_digest THEN RAISE EXCEPTION 'Grant changed' USING ERRCODE='LG409';END IF;
 IF expected_revision IS NULL OR expected_revision<0 OR new_scopes IS NULL OR new_scopes NOT IN(ARRAY[]::text[],ARRAY['file-handoff:read'],ARRAY['file-handoff:read','file-handoff:write']) OR new_consumer IS NOT NULL AND new_consumer<>'codex' OR cardinality(new_scopes)=0 AND new_consumer IS NOT NULL THEN RAISE EXCEPTION 'Invalid file permission' USING ERRCODE='LG400';END IF;
 before_state:=lifeos_agent.read_file_handoff_permission(g,b.owner_id,b.space_id);
 IF COALESCE((before_state->>'revision')::integer,0)<>expected_revision THEN RAISE EXCEPTION 'File permission changed' USING ERRCODE='LG409';END IF;
 IF before_state->'scopes'=to_jsonb(new_scopes) AND before_state->>'consumer' IS NOT DISTINCT FROM new_consumer THEN RETURN before_state;END IF;
 INSERT INTO lifeos_agent.file_handoff_permission VALUES(g,b.owner_id,b.space_id,expected_revision+1,new_scopes,new_consumer)
 ON CONFLICT(grant_id) DO UPDATE SET revision=EXCLUDED.revision,scopes=EXCLUDED.scopes,consumer=EXCLUDED.consumer;
 after_state:=lifeos_agent.read_file_handoff_permission(g,b.owner_id,b.space_id);
 IF after_state IS NULL THEN RAISE EXCEPTION 'Current file identity unavailable' USING ERRCODE='LG403';END IF;
 INSERT INTO lifeos_agent.file_handoff_permission_audit(grant_id,owner_id,space_id,before_state,after_state) VALUES(g,b.owner_id,b.space_id,before_state,after_state);
 RETURN after_state;
END $$;$definition$;
  ELSE RAISE EXCEPTION 'Unreviewed session freshness function source';END IF;
 END IF;
END $patch$;

COMMIT;
