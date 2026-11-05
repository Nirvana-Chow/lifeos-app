-- Source candidate only. No role, key, expiry or existing grant is modified.
-- Exact-target activation and a policy-aware private issuer/verifier are separate gates.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
DO $$
BEGIN
 IF current_setting('lifeos.business_policy_approved',true) IS DISTINCT FROM '1'
 OR current_setting('lifeos.agent_expected_database',true) IS DISTINCT FROM current_database()
 OR current_setting('lifeos.agent_expected_owner',true) IS DISTINCT FROM (SELECT owner_id FROM lifeos_agent.key_management_binding)
 OR current_setting('lifeos.agent_expected_space',true) IS DISTINCT FROM (SELECT space_id FROM lifeos_agent.key_management_binding)
 OR (SELECT count(*) FROM lifeos_agent.key_management_binding)<>1
 OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap','lifeos_agent_issuer','lifeos_agent_verifier','lifeos_agent_key_manager')
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.apikey'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR to_regprocedure('lifeos_agent.requirements_permission_version()') IS NULL
 OR to_regprocedure('lifeos_agent.set_managed_grant_scopes(text,text,text,jsonb)') IS NULL
 OR EXISTS(SELECT 1 FROM pg_roles r WHERE rolname IN ('lifeos_agent_key_manager','lifeos_agent_verifier','lifeos_platform_candidate_runtime') AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolbypassrls OR r.rolreplication OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)))
 OR EXISTS(SELECT 1 FROM (VALUES ('permissions'),('metadata'),('key'),('expiresAt'),('referenceId')) col(name) CROSS JOIN (VALUES ('lifeos_agent_key_manager'),('lifeos_agent_verifier')) role(name) WHERE has_column_privilege(role.name,'lifeos_agent.apikey',col.name,'UPDATE'))
 THEN RAISE EXCEPTION 'Explicit policy target approval, owning migration role and restricted0014 prerequisites required'; END IF;
END
$$;

-- Only the existing independent migration owner can alter this trusted registry.
-- Runtime/module readiness is an additional application gate; a registration alone enables nothing.
CREATE TABLE lifeos_agent.business_policy_control(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), enabled boolean NOT NULL DEFAULT false);
INSERT INTO lifeos_agent.business_policy_control(singleton) VALUES(true);
CREATE TABLE lifeos_agent.business_policy_operation(
 operation_id text PRIMARY KEY CHECK(operation_id ~ '^[A-Za-z][A-Za-z0-9]{0,79}$'),
 required_scopes text[] NOT NULL,
 enabled boolean NOT NULL DEFAULT false
);
REVOKE ALL ON lifeos_agent.business_policy_control,lifeos_agent.business_policy_operation FROM PUBLIC;

CREATE FUNCTION lifeos_agent.valid_personal_business_scopes(scopes text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT COALESCE(cardinality(scopes)>0 AND array_ndims(scopes)=1 AND array_position(scopes,NULL) IS NULL
 AND cardinality(scopes)=(SELECT count(DISTINCT s) FROM unnest(scopes) s)
 AND NOT EXISTS(SELECT 1 FROM unnest(scopes) s WHERE s !~ '^[a-z][a-z0-9-]*:(read|write)$'
  OR split_part(s,':',1)=ANY(ARRAY['account','security','key','keys','apikey','auth','settings','system','payment','payments','order','orders'])
  OR split_part(s,':',2)='write' AND NOT split_part(s,':',1)||':read'=ANY(scopes)),false)
$$;
ALTER TABLE lifeos_agent.business_policy_operation ADD CONSTRAINT personal_business_scopes CHECK(
 lifeos_agent.valid_personal_business_scopes(required_scopes)
 OR operation_id IN ('createTodo','updateTodo') AND required_scopes=ARRAY['todo:write']);
-- Exactly the currently reviewed data operations. Catalog endpoints carry no data scope.
INSERT INTO lifeos_agent.business_policy_operation(operation_id,required_scopes) VALUES
 ('snapshotRequirements',ARRAY['requirements:read']),('getRequirement',ARRAY['requirements:read']),
 ('createRequirement',ARRAY['requirements:read','requirements:write']),('updateRequirement',ARRAY['requirements:read','requirements:write']),
 ('previewTodoClassification',ARRAY['todo:read','organization:read']),('commitTodoClassification',ARRAY['todo:read','todo:write','organization:read']),
 ('listTodos',ARRAY['todo:read']),('snapshotTodos',ARRAY['todo:read']),('getTodo',ARRAY['todo:read']),
 ('createTodo',ARRAY['todo:write']),('updateTodo',ARRAY['todo:write']),
 ('snapshotOrganization',ARRAY['organization:read']),('getOrganization',ARRAY['organization:read']),
 ('createOrganization',ARRAY['organization:read','organization:write']),('updateOrganization',ARRAY['organization:read','organization:write']);

CREATE FUNCTION lifeos_agent.business_policy_catalog()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('version','all-personal-business-v1','enabled',c.enabled,'operations',
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',operation_id,'requiredScopes',required_scopes,'enabled',enabled) ORDER BY operation_id) FROM lifeos_agent.business_policy_operation),'[]'::jsonb))
 FROM lifeos_agent.business_policy_control c WHERE singleton
$$;

-- Keep old digest bytes stable. Only policy-bearing rows use the additive version2 projection.
CREATE FUNCTION lifeos_agent.current_managed_grant_digest(grant_id text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE WHEN NOT k.metadata::jsonb?'businessDataPolicy' THEN lifeos_agent.managed_grant_digest(grant_id)
 ELSE encode(sha256(convert_to(jsonb_build_object('version',2,'legacyDigest',lifeos_agent.managed_grant_digest(grant_id),
  'businessDataPolicy',k.metadata::jsonb->'businessDataPolicy')::text,'UTF8')),'hex') END
 FROM lifeos_agent.apikey k JOIN lifeos_agent.key_management_binding b ON k."referenceId"=b.owner_id AND k.metadata::jsonb->>'spaceId'=b.space_id
 WHERE k.id=grant_id AND k."configId"='default'
$$;
ALTER TABLE lifeos_agent.grant_scope_audit ADD COLUMN before_policy text, ADD COLUMN after_policy text;

CREATE FUNCTION lifeos_agent.set_managed_business_grant(session_token text,grant_id text,expected_digest text,new_permissions jsonb,new_policy text)
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
 AND s."expiresAt">clock_timestamp() AND s."mfaVerified" IS TRUE AND u."twoFactorEnabled" IS TRUE AND f.verified IS TRUE)
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
$$;
-- Old signers cannot silently alter a policy grant using the old policy-blind digest.
CREATE OR REPLACE FUNCTION lifeos_agent.set_managed_grant_scopes(session_token text,grant_id text,expected_digest text,new_permissions jsonb)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT lifeos_agent.set_managed_business_grant(session_token,grant_id,expected_digest,new_permissions,NULL)
$$;

CREATE FUNCTION lifeos_agent.assert_current_business_grant(grant_id text,owner_id text,space_id text,required_scopes text[],expected_policy text,claimed_operation_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE grant_row lifeos_agent.apikey%ROWTYPE; control_enabled boolean; operation_row lifeos_agent.business_policy_operation%ROWTYPE;
BEGIN
 IF current_setting('lifeos.owner_id',true) IS DISTINCT FROM owner_id
 OR expected_policy IS NULL AND NOT lifeos_agent.valid_personal_business_scopes(required_scopes) THEN RETURN false; END IF;
 -- Fence order: policy control -> exact operation -> grant. Gates stay locked until business COMMIT.
 IF expected_policy IS NOT NULL THEN
  IF expected_policy<>'all-personal-business-v1' OR claimed_operation_id IS NULL THEN RETURN false; END IF;
  SELECT enabled INTO control_enabled FROM lifeos_agent.business_policy_control WHERE singleton FOR SHARE;
  IF control_enabled IS NOT TRUE THEN RETURN false; END IF;
  SELECT o.* INTO operation_row FROM lifeos_agent.business_policy_operation o WHERE o.operation_id=claimed_operation_id FOR SHARE;
  IF NOT FOUND OR operation_row.enabled IS NOT TRUE OR operation_row.required_scopes IS DISTINCT FROM required_scopes THEN RETURN false; END IF;
 END IF;
 SELECT * INTO grant_row FROM lifeos_agent.apikey WHERE id=grant_id FOR SHARE;
 IF NOT FOUND OR grant_row."configId"<>'default' OR grant_row."referenceId" IS DISTINCT FROM owner_id
 OR grant_row.metadata::jsonb->>'spaceId' IS DISTINCT FROM space_id OR grant_row.enabled IS NOT TRUE
 OR grant_row."expiresAt" IS NULL OR grant_row."expiresAt"<=clock_timestamp()
 OR NOT lifeos_agent.valid_business_permissions(grant_row.permissions::jsonb)
 OR grant_row.metadata::jsonb->>'businessDataPolicy' IS DISTINCT FROM expected_policy THEN RETURN false; END IF;
 IF expected_policy IS NULL THEN
  -- Current old-key semantics and old scoped-permission validator remain authoritative.
  RETURN lifeos_agent.assert_business_grant(grant_id,owner_id,space_id,required_scopes);
 END IF;
 RETURN true;
END
$$;

-- Issuance remains closed until the independent owner enables the policy control.
-- Reuse the existing RLS policy with an additional condition rather than widening it.
DO $$ DECLARE prior text;
BEGIN
 SELECT pg_get_expr(polwithcheck,polrelid) INTO prior FROM pg_policy WHERE polrelid='lifeos_agent.apikey'::regclass AND polname='agent_manager_issue';
 IF prior IS NULL THEN RAISE EXCEPTION 'Existing issuer RLS policy required'; END IF;
 EXECUTE 'ALTER POLICY agent_manager_issue ON lifeos_agent.apikey WITH CHECK (('||prior||') AND (NOT metadata::jsonb?''businessDataPolicy'' OR (metadata::jsonb->>''businessDataPolicy''=''all-personal-business-v1'' AND (lifeos_agent.business_policy_catalog()->>''enabled'')::boolean)))';
END $$;
REVOKE ALL ON FUNCTION lifeos_agent.valid_personal_business_scopes(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION lifeos_agent.business_policy_catalog() FROM PUBLIC;
REVOKE ALL ON FUNCTION lifeos_agent.current_managed_grant_digest(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION lifeos_agent.set_managed_business_grant(text,text,text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION lifeos_agent.assert_current_business_grant(text,text,text,text[],text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lifeos_agent.business_policy_catalog() TO lifeos_agent_key_manager,lifeos_agent_verifier,lifeos_platform_candidate_runtime;
GRANT EXECUTE ON FUNCTION lifeos_agent.current_managed_grant_digest(text),lifeos_agent.set_managed_business_grant(text,text,text,jsonb,text) TO lifeos_agent_key_manager;
GRANT EXECUTE ON FUNCTION lifeos_agent.assert_current_business_grant(text,text,text,text[],text,text) TO lifeos_platform_candidate_runtime;
COMMIT;
