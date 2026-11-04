-- Proposed only. Requires independently approved exact target and pre-existing
-- schema2, Agent key management, native MFA, roles and fixed owner/space binding.
-- Creates no roles, passwords or grants for an existing key.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
DO $$
BEGIN
 IF current_setting('lifeos.agent_business_grants_approved',true) IS DISTINCT FROM '1'
    OR current_setting('lifeos.agent_expected_database',true) IS DISTINCT FROM current_database()
    OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap',
                        'lifeos_agent_issuer','lifeos_agent_verifier','lifeos_agent_key_manager')
    OR to_regclass('lifeos_agent.key_management_binding') IS NULL
    OR to_regclass('lifeos_platform.platform_two_factor') IS NULL
    OR to_regprocedure('lifeos_agent.verify_management_session(text,text,text)') IS NULL
    OR to_regprocedure('lifeos_agent.assert_todo_write_grant(text,text,text)') IS NULL
    OR (SELECT version FROM lifeos_platform.platform_meta) IS DISTINCT FROM 2
    OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.apikey'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
    OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.key_management_binding'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
    OR (SELECT count(*) FROM lifeos_agent.key_management_binding)<>1
    OR EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN ('lifeos_agent_key_manager','lifeos_agent_verifier','lifeos_platform_candidate_runtime')
      AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolbypassrls OR r.rolreplication
       OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)))
    OR has_column_privilege('lifeos_agent_key_manager','lifeos_agent.apikey','permissions','UPDATE')
    OR has_column_privilege('lifeos_agent_key_manager','lifeos_agent.apikey','metadata','UPDATE')
    OR has_column_privilege('lifeos_agent_key_manager','lifeos_agent.apikey','key','UPDATE')
    OR has_column_privilege('lifeos_agent_key_manager','lifeos_agent.apikey','expiresAt','UPDATE') THEN
  RAISE EXCEPTION 'Explicit exact-target approval, independent migration owner and restricted prerequisites required';
 END IF;
END
$$;

-- One canonical JSON permission language: each present domain must have read,
-- optionally followed by write. Empty, unknown, duplicate and write-only fail.
CREATE FUNCTION lifeos_agent.valid_business_permissions(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT COALESCE(jsonb_typeof(value)='object' AND value<>'{}'::jsonb
  AND value-ARRAY['todo','organization']='{}'::jsonb
  AND (NOT value?'todo' OR value->'todo' IN ('["read"]'::jsonb,'["read","write"]'::jsonb))
  AND (NOT value?'organization' OR value->'organization' IN ('["read"]'::jsonb,'["read","write"]'::jsonb)),false)
$$;
REVOKE ALL ON FUNCTION lifeos_agent.valid_business_permissions(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lifeos_agent.valid_business_permissions(jsonb) TO lifeos_agent_key_manager;

CREATE FUNCTION lifeos_agent.managed_grant_digest(grant_id text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object(
  'version',1,'id',k.id,'ownerId',k."referenceId",'spaceId',k.metadata::jsonb->>'spaceId',
  'enabled',k.enabled,'expiresAt',to_char(k."expiresAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'permissions',k.permissions::jsonb)::text,'UTF8')),'hex')
 FROM lifeos_agent.apikey k JOIN lifeos_agent.key_management_binding b
  ON k."referenceId"=b.owner_id AND k.metadata::jsonb->>'spaceId'=b.space_id
 WHERE k.id=grant_id AND k."configId"='default'
$$;
REVOKE ALL ON FUNCTION lifeos_agent.managed_grant_digest(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lifeos_agent.managed_grant_digest(text) TO lifeos_agent_key_manager;

CREATE TABLE lifeos_agent.grant_scope_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 owner_id text NOT NULL, space_id text NOT NULL, grant_id text NOT NULL,
 before_permissions jsonb NOT NULL, after_permissions jsonb NOT NULL,
 before_digest text NOT NULL, after_digest text NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON lifeos_agent.grant_scope_audit FROM PUBLIC;
REVOKE ALL ON SEQUENCE lifeos_agent.grant_scope_audit_id_seq FROM PUBLIC;

CREATE FUNCTION lifeos_agent.set_managed_grant_scopes(session_token text,grant_id text,expected_digest text,new_permissions jsonb)
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
    AND s."mfaVerified" IS TRUE AND u."twoFactorEnabled" IS TRUE AND f.verified IS TRUE
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
$$;
REVOKE ALL ON FUNCTION lifeos_agent.set_managed_grant_scopes(text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lifeos_agent.set_managed_grant_scopes(text,text,text,jsonb) TO lifeos_agent_key_manager;

-- Same row lock and connection as the business transaction. SHARE conflicts
-- with scope CAS, revocation, deletion and usage updates until transaction end.
CREATE FUNCTION lifeos_agent.assert_business_grant(grant_id text,owner_id text,space_id text,required_scopes text[])
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE grant_row lifeos_agent.apikey%ROWTYPE; scope text;
BEGIN
 IF current_setting('lifeos.owner_id',true) IS DISTINCT FROM owner_id
    OR required_scopes IS NULL OR cardinality(required_scopes)=0
    OR array_ndims(required_scopes)<>1 OR array_position(required_scopes,NULL) IS NOT NULL
    OR NOT required_scopes<@ARRAY['todo:read','todo:write','organization:read','organization:write']::text[]
    OR ('todo:write'=ANY(required_scopes) AND NOT 'todo:read'=ANY(required_scopes))
    OR ('organization:write'=ANY(required_scopes) AND NOT 'organization:read'=ANY(required_scopes)) THEN RETURN false; END IF;
 SELECT * INTO grant_row FROM lifeos_agent.apikey WHERE id=grant_id FOR SHARE;
 IF NOT FOUND OR grant_row."configId"<>'default' OR grant_row."referenceId" IS DISTINCT FROM owner_id
    OR grant_row.metadata::jsonb->>'spaceId' IS DISTINCT FROM space_id OR grant_row.enabled IS NOT TRUE
    OR grant_row."expiresAt" IS NULL OR grant_row."expiresAt"<=clock_timestamp()
    OR NOT lifeos_agent.valid_business_permissions(grant_row.permissions::jsonb) THEN RETURN false; END IF;
 FOREACH scope IN ARRAY required_scopes LOOP
  IF NOT COALESCE(grant_row.permissions::jsonb->split_part(scope,':',1)?split_part(scope,':',2),false) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END
$$;
REVOKE ALL ON FUNCTION lifeos_agent.assert_business_grant(text,text,text,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lifeos_agent.assert_business_grant(text,text,text,text[]) TO lifeos_platform_candidate_runtime;

-- Existing call sites retain their exact function signature; only legacy
-- deployments without this migration continue using the original definition.
CREATE OR REPLACE FUNCTION lifeos_agent.assert_todo_write_grant(grant_id text,owner_id text,space_id text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT lifeos_agent.assert_business_grant(grant_id,owner_id,space_id,ARRAY['todo:read','todo:write'])
$$;
REVOKE ALL ON FUNCTION lifeos_agent.assert_todo_write_grant(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lifeos_agent.assert_todo_write_grant(text,text,text) TO lifeos_platform_candidate_runtime;

-- The opt-in issuer uses the same codecs as the runtime. No broader UPDATE.
ALTER POLICY agent_manager_issue ON lifeos_agent.apikey WITH CHECK (
 enabled IS TRUE AND "expiresAt">statement_timestamp() AND "expiresAt"<=statement_timestamp()+interval '8760 hours'
 AND "configId"='default' AND "rateLimitEnabled" IS TRUE AND "rateLimitTimeWindow"=60000 AND "rateLimitMax"=20
 AND lifeos_agent.valid_business_permissions(permissions::jsonb) AND jsonb_typeof(metadata::jsonb)='object'
 AND lifeos_agent.key_management_binding_matches("referenceId",metadata::jsonb->>'spaceId')
);
COMMIT;
