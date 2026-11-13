-- PROPOSED: explicit owner/MFA file permissions; never inferred from old business policy.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
DO $$ BEGIN
 IF current_setting('lifeos.file_handoff_grants_approved',true) IS DISTINCT FROM 'file-handoff-grants-v1'
 OR current_setting('lifeos.agent_expected_database',true) IS DISTINCT FROM current_database()
 OR NOT lifeos_agent.key_management_binding_matches(current_setting('lifeos.agent_expected_owner',true),current_setting('lifeos.agent_expected_space',true))
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.apikey'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR to_regclass('lifeos_agent.file_handoff_permission') IS NOT NULL
 THEN RAISE EXCEPTION 'Exact approved migration owner and fresh file permissions target required';END IF;
END $$;
CREATE TABLE lifeos_agent.file_handoff_permission(
 grant_id text PRIMARY KEY REFERENCES lifeos_agent.apikey(id),owner_id text NOT NULL,space_id text NOT NULL,
 revision integer NOT NULL CHECK(revision>0),scopes text[] NOT NULL,consumer text CHECK(consumer='codex'),
 CHECK(scopes IN(ARRAY[]::text[],ARRAY['file-handoff:read'],ARRAY['file-handoff:read','file-handoff:write'])),
 CHECK(cardinality(scopes)>0 OR consumer IS NULL)
);
CREATE TABLE lifeos_agent.file_handoff_permission_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,grant_id text NOT NULL,owner_id text NOT NULL,space_id text NOT NULL,
 before_state jsonb,after_state jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON lifeos_agent.file_handoff_permission,lifeos_agent.file_handoff_permission_audit FROM PUBLIC,lifeos_agent_key_manager,lifeos_agent_verifier,lifeos_platform_candidate_runtime;
REVOKE ALL ON SEQUENCE lifeos_agent.file_handoff_permission_audit_id_seq FROM PUBLIC,lifeos_agent_key_manager,lifeos_agent_verifier,lifeos_platform_candidate_runtime;

CREATE FUNCTION lifeos_agent.file_handoff_permissions_version() RETURNS text LANGUAGE sql SET search_path=pg_catalog,pg_temp AS $$SELECT 'file-handoff-v1'::text$$;
-- Native file authority uses the original owner/MFA records without requiring
-- the independently activated OAuth delegation service to be enabled.
CREATE FUNCTION lifeos_agent.file_handoff_identity_ready(o text,s text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT lifeos_agent.key_management_binding_matches(o,s) THEN RETURN false;END IF;
 PERFORM 1 FROM lifeos_platform.platform_user WHERE id=o AND "twoFactorEnabled" IS TRUE FOR SHARE;
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM 1 FROM lifeos_platform.platform_two_factor WHERE "userId"=o AND verified IS TRUE FOR SHARE;
 RETURN FOUND;
END $$;
CREATE FUNCTION lifeos_agent.read_file_handoff_permission(g text,o text,s text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE k lifeos_agent.apikey%ROWTYPE;p lifeos_agent.file_handoff_permission%ROWTYPE;v jsonb;BEGIN
 IF NOT lifeos_agent.key_management_binding_matches(o,s) THEN RETURN NULL;END IF;
 SELECT * INTO k FROM lifeos_agent.apikey WHERE id=g FOR SHARE;
 IF NOT FOUND OR k.enabled IS NOT TRUE OR k."referenceId" IS DISTINCT FROM o OR k.metadata::jsonb->>'spaceId' IS DISTINCT FROM s OR k."expiresAt" IS NULL OR k."expiresAt"<=clock_timestamp() OR NOT lifeos_agent.valid_business_permissions(k.permissions::jsonb) THEN RETURN NULL;END IF;
 SELECT * INTO p FROM lifeos_agent.file_handoff_permission WHERE grant_id=g AND owner_id=o AND space_id=s FOR SHARE;
 IF NOT FOUND THEN RETURN NULL;END IF;
 -- Original transaction gate -> key -> file permission -> native identity.
 IF NOT lifeos_agent.file_handoff_identity_ready(o,s) THEN RETURN NULL;END IF;
 v:=jsonb_build_object('version','file-handoff-v1','revision',p.revision,'scopes',p.scopes,'consumer',p.consumer);
 RETURN v||jsonb_build_object('digest',encode(sha256(convert_to(v::text,'UTF8')),'hex'));
END $$;
CREATE FUNCTION lifeos_agent.assert_file_handoff_permission(g text,o text,s text,r integer,required text[],operation text,consumer text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v jsonb;expected text[];BEGIN
 expected:=CASE operation WHEN 'stageFileHandoff' THEN ARRAY['file-handoff:read','file-handoff:write'] WHEN 'getFileHandoff' THEN ARRAY['file-handoff:read'] WHEN 'downloadFileHandoff' THEN ARRAY['file-handoff:read'] WHEN 'acknowledgeFileHandoff' THEN ARRAY['file-handoff:read','file-handoff:write'] ELSE NULL END;
 IF expected IS NULL OR required IS DISTINCT FROM expected THEN RETURN false;END IF;
 v:=lifeos_agent.read_file_handoff_permission(g,o,s);
 RETURN v IS NOT NULL AND (v->>'revision')::integer=r AND to_jsonb(required)<@(v->'scopes') AND (operation<>'acknowledgeFileHandoff' OR consumer='codex' AND v->>'consumer'='codex');
END $$;
CREATE FUNCTION lifeos_agent.set_file_handoff_permission(session_token text,g text,expected_digest text,expected_revision integer,new_scopes text[],new_consumer text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE b lifeos_agent.key_management_binding%ROWTYPE;k lifeos_agent.apikey%ROWTYPE;before_state jsonb;after_state jsonb;actual_digest text;BEGIN
 SELECT * INTO b FROM lifeos_agent.key_management_binding;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('lifeos:personal-owner-maintenance:v1:'||b.owner_id,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('lifeos-business-mcp-oauth-v1',0));
 SELECT * INTO k FROM lifeos_agent.apikey WHERE id=g FOR UPDATE;
 IF NOT FOUND OR k.enabled IS NOT TRUE OR k."referenceId" IS DISTINCT FROM b.owner_id OR k.metadata::jsonb->>'spaceId' IS DISTINCT FROM b.space_id OR k."expiresAt" IS NULL OR k."expiresAt"<=clock_timestamp() THEN RAISE EXCEPTION 'Grant unavailable' USING ERRCODE='LG403';END IF;
 IF NOT EXISTS(SELECT 1 FROM lifeos_platform.platform_session x JOIN lifeos_platform.platform_user u ON u.id=x."userId" JOIN lifeos_platform.platform_two_factor f ON f."userId"=u.id WHERE x.token=session_token AND u.id=b.owner_id AND x."expiresAt">clock_timestamp() AND x."mfaVerified" IS TRUE AND u."twoFactorEnabled" IS TRUE AND f.verified IS TRUE) THEN RAISE EXCEPTION 'Owner MFA required' USING ERRCODE='LG401';END IF;
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
END $$;
CREATE FUNCTION lifeos_agent.assert_file_handoff_owner(session_id text,o text,s text,email text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE current_token text;BEGIN
 IF NOT lifeos_agent.key_management_binding_matches(o,s) THEN RETURN false;END IF;
 SELECT token INTO current_token FROM lifeos_platform.platform_session WHERE id=session_id AND "userId"=o AND "expiresAt">clock_timestamp() AND "mfaVerified" IS TRUE FOR SHARE;
 IF NOT FOUND OR NOT lifeos_agent.file_handoff_identity_ready(o,s) THEN RETURN false;END IF;
 RETURN lifeos_agent.verify_management_session(current_token,o,email);
END $$;
-- Preserve the original provider/ledger implementation. File-enabled consent and
-- token publication additionally hold the current explicit file permission row.
CREATE FUNCTION lifeos_agent.approve_file_handoff_oauth_binding(session_id text,g text,o text,s text,client_id text,approved_scopes text[]) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE required text[];p jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('lifeos-business-mcp-oauth-v1',0));
 SELECT COALESCE(array_agg(x ORDER BY x),ARRAY[]::text[]) INTO required FROM unnest(approved_scopes) x WHERE x LIKE 'file-handoff:%';
 IF cardinality(required)>0 THEN
  p:=lifeos_agent.read_file_handoff_permission(g,o,s);
  IF p IS NULL OR NOT to_jsonb(required)<@(p->'scopes') THEN RETURN false;END IF;
 END IF;
 RETURN lifeos_agent.approve_oauth_business_binding(session_id,g,o,s,client_id,approved_scopes);
END $$;
CREATE FUNCTION lifeos_agent.register_file_handoff_oauth_token(g text,o text,s text,token_id text,claims jsonb,grant_type text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE required text[];p jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('lifeos-business-mcp-oauth-v1',0));
 SELECT COALESCE(array_agg(x ORDER BY x),ARRAY[]::text[]) INTO required FROM unnest(string_to_array(claims->>'scope',' ')) x WHERE x LIKE 'file-handoff:%';
 IF cardinality(required)>0 THEN
  p:=lifeos_agent.read_file_handoff_permission(g,o,s);
  IF p IS NULL OR NOT to_jsonb(required)<@(p->'scopes') THEN RETURN NULL;END IF;
 END IF;
 RETURN lifeos_agent.register_oauth_business_token(g,o,s,token_id,claims,grant_type);
END $$;
REVOKE ALL ON FUNCTION lifeos_agent.file_handoff_permissions_version(),lifeos_agent.read_file_handoff_permission(text,text,text),lifeos_agent.assert_file_handoff_permission(text,text,text,integer,text[],text,text),lifeos_agent.set_file_handoff_permission(text,text,text,integer,text[],text) FROM PUBLIC;
REVOKE ALL ON FUNCTION lifeos_agent.file_handoff_identity_ready(text,text),lifeos_agent.assert_file_handoff_owner(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION lifeos_agent.approve_file_handoff_oauth_binding(text,text,text,text,text,text[]),lifeos_agent.register_file_handoff_oauth_token(text,text,text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lifeos_agent.file_handoff_permissions_version(),lifeos_agent.read_file_handoff_permission(text,text,text) TO lifeos_agent_key_manager,lifeos_agent_verifier,lifeos_platform_candidate_runtime;
GRANT EXECUTE ON FUNCTION lifeos_agent.assert_file_handoff_permission(text,text,text,integer,text[],text,text) TO lifeos_platform_candidate_runtime;
GRANT EXECUTE ON FUNCTION lifeos_agent.assert_file_handoff_owner(text,text,text,text) TO lifeos_platform_candidate_runtime;
GRANT EXECUTE ON FUNCTION lifeos_agent.approve_file_handoff_oauth_binding(text,text,text,text,text,text[]),lifeos_agent.register_file_handoff_oauth_token(text,text,text,text,jsonb,text) TO lifeos_platform_candidate_runtime;
GRANT EXECUTE ON FUNCTION lifeos_agent.set_file_handoff_permission(text,text,text,integer,text[],text) TO lifeos_agent_key_manager;
-- These new IDs do not enter the old automatic business-policy registry.
INSERT INTO lifeos_agent.oauth_business_operation VALUES('stageFileHandoff',ARRAY['file-handoff:read','file-handoff:write']),('getFileHandoff',ARRAY['file-handoff:read']);
COMMIT;
