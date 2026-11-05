-- Source proposal only: registration is not activation, issuance or a grant change.
-- Apply only in a separately authorized exact-target schema-administration step.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
DO $$
BEGIN
 IF current_setting('lifeos.business_records_approved',true) IS DISTINCT FROM '1'
 OR current_setting('lifeos.agent_expected_database',true) IS DISTINCT FROM current_database()
 OR current_setting('lifeos.agent_expected_owner',true) IS DISTINCT FROM (SELECT owner_id FROM lifeos_agent.key_management_binding)
 OR current_setting('lifeos.agent_expected_space',true) IS DISTINCT FROM (SELECT space_id FROM lifeos_agent.key_management_binding)
 OR (SELECT count(*) FROM lifeos_agent.key_management_binding)<>1
 OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap','lifeos_agent_issuer','lifeos_agent_verifier','lifeos_agent_key_manager')
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.apikey'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.business_policy_operation'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR to_regprocedure('lifeos_agent.assert_current_business_grant(text,text,text,text[],text,text)') IS NULL
 THEN RAISE EXCEPTION 'Explicit record-operation target approval and the owning policy migration role required'; END IF;
END
$$;
-- All enabled values inherit the existing false default. No policy control,
-- operation activation, legacy permissions, key metadata, identity or expiry is changed.
INSERT INTO lifeos_agent.business_policy_operation(operation_id,required_scopes) VALUES
 ('snapshotJournal',ARRAY['journal:read']),
 ('getJournal',ARRAY['journal:read']),
 ('createJournal',ARRAY['journal:read','journal:write']),
 ('updateJournal',ARRAY['journal:read','journal:write']),
 ('snapshotCalendar',ARRAY['calendar:read']),
 ('getCalendar',ARRAY['calendar:read']),
 ('createCalendar',ARRAY['calendar:read','calendar:write']),
 ('updateCalendar',ARRAY['calendar:read','calendar:write']),
 ('snapshotHealth',ARRAY['health:read']),
 ('getHealth',ARRAY['health:read']),
 ('createHealth',ARRAY['health:read','health:write']),
 ('updateHealth',ARRAY['health:read','health:write']),
 ('snapshotPerson',ARRAY['person:read']),
 ('getPerson',ARRAY['person:read']),
 ('createPerson',ARRAY['person:read','person:write']),
 ('updatePerson',ARRAY['person:read','person:write']),
 ('snapshotFinance',ARRAY['finance:read']),
 ('getFinance',ARRAY['finance:read']),
 ('createFinance',ARRAY['finance:read','finance:write']),
 ('updateFinance',ARRAY['finance:read','finance:write']),
 ('snapshotFeedback',ARRAY['feedback:read']),
 ('getFeedback',ARRAY['feedback:read']),
 ('createFeedback',ARRAY['feedback:read','feedback:write']);
COMMIT;
