-- Source proposal only: registration is not activation, issuance or a grant change.
-- Apply only in a separately authorized exact-target schema-administration step.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
DO $$
BEGIN
 IF current_setting('lifeos.three_business_records_approved',true) IS DISTINCT FROM '1'
 OR current_setting('lifeos.agent_expected_database',true) IS DISTINCT FROM current_database()
 OR current_setting('lifeos.agent_expected_owner',true) IS DISTINCT FROM (SELECT owner_id FROM lifeos_agent.key_management_binding)
 OR current_setting('lifeos.agent_expected_space',true) IS DISTINCT FROM (SELECT space_id FROM lifeos_agent.key_management_binding)
 OR (SELECT count(*) FROM lifeos_agent.key_management_binding)<>1
 OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap','lifeos_agent_issuer','lifeos_agent_verifier','lifeos_agent_key_manager')
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.apikey'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.business_policy_operation'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR to_regprocedure('lifeos_agent.assert_current_business_grant(text,text,text,text[],text,text)') IS NULL
 THEN RAISE EXCEPTION 'Explicit three-business operation target approval and the owning policy migration role required'; END IF;
END
$$;
-- Inherit enabled=false. Do not enable a policy/operation or change legacy keys.
-- Existing0016/0017 functions, source digests and registrations stay unchanged.
INSERT INTO lifeos_agent.business_policy_operation(operation_id,required_scopes) VALUES
 ('snapshotMedia',ARRAY['media:read']),
 ('getMedia',ARRAY['media:read']),
 ('createMedia',ARRAY['media:read','media:write']),
 ('updateMedia',ARRAY['media:read','media:write']),
 ('snapshotCareer',ARRAY['career:read']),
 ('getCareer',ARRAY['career:read']),
 ('createCareer',ARRAY['career:read','career:write']),
 ('updateCareer',ARRAY['career:read','career:write']),
 ('snapshotPortfolio',ARRAY['portfolio:read']),
 ('getPortfolio',ARRAY['portfolio:read']),
 ('createPortfolio',ARRAY['portfolio:read','portfolio:write']),
 ('updatePortfolio',ARRAY['portfolio:read','portfolio:write']);
COMMIT;
