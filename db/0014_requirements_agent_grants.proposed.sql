-- Proposed only: requirements scopes; no existing grant is modified.
-- Prerequisites: schema2 + 0006/0010/0011, exact owner/space binding and MFA.
-- Owner requirements CRUD uses schema2 independently and needs no part of this migration.
-- Run only as the owning migration role in an explicitly approved disposable or production target.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
DO $$
BEGIN
 IF current_setting('lifeos.requirements_grants_approved',true) IS DISTINCT FROM '1'
 OR current_setting('lifeos.agent_expected_database',true) IS DISTINCT FROM current_database()
 OR current_setting('lifeos.agent_expected_owner',true) IS DISTINCT FROM (SELECT owner_id FROM lifeos_agent.key_management_binding)
 OR current_setting('lifeos.agent_expected_space',true) IS DISTINCT FROM (SELECT space_id FROM lifeos_agent.key_management_binding)
 OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap','lifeos_agent_issuer','lifeos_agent_verifier','lifeos_agent_key_manager')
 OR (SELECT version FROM lifeos_platform.platform_meta) IS DISTINCT FROM 2
 OR (SELECT count(*) FROM lifeos_agent.key_management_binding)<>1
 OR to_regclass('lifeos_agent.grant_scope_audit') IS NULL
 OR to_regprocedure('lifeos_agent.set_managed_grant_scopes(text,text,text,jsonb)') IS NULL
 OR to_regprocedure('lifeos_agent.assert_business_grant(text,text,text,text[])') IS NULL
 OR (SELECT proowner FROM pg_proc WHERE oid='lifeos_agent.assert_business_grant(text,text,text,text[])'::regprocedure) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.apikey'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN ('lifeos_agent_key_manager','lifeos_agent_verifier','lifeos_platform_candidate_runtime') AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolbypassrls OR r.rolreplication OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)))
 THEN RAISE EXCEPTION 'Explicit exact-target requirements approval, owning migration role and restricted0011 prerequisites required'; END IF;
END
$$;
CREATE OR REPLACE FUNCTION lifeos_agent.valid_business_permissions(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
 SELECT COALESCE(jsonb_typeof(value)='object' AND value<>'{}'::jsonb
  AND value-ARRAY['todo','organization','requirements']='{}'::jsonb
  AND (NOT value?'todo' OR value->'todo' IN ('["read"]'::jsonb,'["read","write"]'::jsonb))
  AND (NOT value?'organization' OR value->'organization' IN ('["read"]'::jsonb,'["read","write"]'::jsonb))
  AND (NOT value?'requirements' OR value->'requirements' IN ('["read"]'::jsonb,'["read","write"]'::jsonb)),false)
$$;

CREATE OR REPLACE FUNCTION lifeos_agent.assert_business_grant(grant_id text,owner_id text,space_id text,required_scopes text[])
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE grant_row lifeos_agent.apikey%ROWTYPE; scope text;
BEGIN
 IF current_setting('lifeos.owner_id',true) IS DISTINCT FROM owner_id
    OR required_scopes IS NULL OR cardinality(required_scopes)=0
    OR array_ndims(required_scopes)<>1 OR array_position(required_scopes,NULL) IS NOT NULL
    OR NOT required_scopes<@ARRAY['todo:read','todo:write','organization:read','organization:write','requirements:read','requirements:write']::text[]
    OR ('todo:write'=ANY(required_scopes) AND NOT 'todo:read'=ANY(required_scopes))
    OR ('organization:write'=ANY(required_scopes) AND NOT 'organization:read'=ANY(required_scopes))
    OR ('requirements:write'=ANY(required_scopes) AND NOT 'requirements:read'=ANY(required_scopes)) THEN RETURN false; END IF;
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

REVOKE ALL ON FUNCTION lifeos_agent.valid_business_permissions(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lifeos_agent.valid_business_permissions(jsonb) TO lifeos_agent_key_manager;
REVOKE ALL ON FUNCTION lifeos_agent.assert_business_grant(text,text,text,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lifeos_agent.assert_business_grant(text,text,text,text[]) TO lifeos_platform_candidate_runtime;
-- Readiness marker is independently ACL/owner/search-path checked at runtime and issuer.
CREATE FUNCTION lifeos_agent.requirements_permission_version()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$ SELECT 'requirements-v1'::text $$;
REVOKE ALL ON FUNCTION lifeos_agent.requirements_permission_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lifeos_agent.requirements_permission_version() TO lifeos_agent_key_manager,lifeos_platform_candidate_runtime;
COMMIT;
