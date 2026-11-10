-- Candidate registration. Run only in a separately authorized exact-target administration step.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
DO $$
BEGIN
 IF current_setting('lifeos.cooking_record_operations_approved',true) IS DISTINCT FROM '1'
 OR current_setting('lifeos.agent_expected_database',true) IS DISTINCT FROM current_database()
 OR current_setting('lifeos.agent_expected_owner',true) IS DISTINCT FROM (SELECT owner_id FROM lifeos_agent.key_management_binding)
 OR current_setting('lifeos.agent_expected_space',true) IS DISTINCT FROM (SELECT space_id FROM lifeos_agent.key_management_binding)
 OR (SELECT count(*) FROM lifeos_agent.key_management_binding)<>1
 OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap','lifeos_agent_issuer','lifeos_agent_verifier','lifeos_agent_key_manager')
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.apikey'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.business_policy_operation'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR to_regprocedure('lifeos_agent.assert_current_business_grant(text,text,text,text[],text,text)') IS NULL
 THEN RAISE EXCEPTION 'Explicit cooking operation target approval and the owning policy migration role required'; END IF;
END
$$;
INSERT INTO lifeos_agent.business_policy_operation(operation_id,required_scopes,enabled) VALUES
 ('snapshotCooking',ARRAY['cooking:read'],false),
 ('getCooking',ARRAY['cooking:read'],false),
 ('createCooking',ARRAY['cooking:read','cooking:write'],false),
 ('updateCooking',ARRAY['cooking:read','cooking:write'],false);
COMMIT;
