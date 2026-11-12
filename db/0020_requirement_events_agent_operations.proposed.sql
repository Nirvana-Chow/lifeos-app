-- Source proposal only: the independent Auth/policy owner registers three closed operations.
-- Apply after the platform-owner0020 step, with separately reviewed exact-target approval.
-- No policy activation, key change, ownership transfer or cross-owner private-table grant.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
DO $$
BEGIN
 IF current_setting('lifeos.requirement_events_agent_approved',true) IS DISTINCT FROM '1'
 OR current_setting('lifeos.agent_expected_database',true) IS DISTINCT FROM current_database()
 OR current_setting('lifeos.agent_expected_owner',true) IS DISTINCT FROM (SELECT owner_id FROM lifeos_agent.key_management_binding)
 OR current_setting('lifeos.agent_expected_space',true) IS DISTINCT FROM (SELECT space_id FROM lifeos_agent.key_management_binding)
 OR (SELECT count(*) FROM lifeos_agent.key_management_binding)<>1
 OR (SELECT version FROM lifeos_platform.platform_meta) IS DISTINCT FROM 2
 OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap','lifeos_agent_issuer','lifeos_agent_verifier','lifeos_agent_key_manager')
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.apikey'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.key_management_binding'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.business_policy_operation'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR to_regprocedure('lifeos_agent.assert_business_grant(text,text,text,text[])') IS NULL
 OR to_regprocedure('lifeos_agent.assert_current_business_grant(text,text,text,text[],text,text)') IS NULL
 OR to_regclass('lifeos_platform.requirement_work') IS NULL
 OR to_regclass('lifeos_platform.requirement_event_outbox') IS NULL
 OR to_regclass('lifeos_platform.requirement_claim_command') IS NULL
 OR to_regprocedure('lifeos_platform.capture_requirement_event()') IS NULL
 THEN RAISE EXCEPTION 'Explicit event operation target approval, owning Auth/policy role and platform0020 prerequisites required'; END IF;
END
$$;
-- Each row starts disabled; the existing policy control, legacy grants and keys are untouched.
INSERT INTO lifeos_agent.business_policy_operation(operation_id,required_scopes,enabled) VALUES
 ('streamRequirementEvents',ARRAY['requirements:read'],false),
 ('claimRequirementExecution',ARRAY['requirements:read','requirements:write'],false),
 ('updateRequirementExecution',ARRAY['requirements:read','requirements:write'],false);
COMMIT;
