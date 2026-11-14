-- Source proposal only. Registering this operation never activates it or changes a grant.
-- Apply once, after original0019 storage-review and0021 OAuth, in an exact approved target.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
DO $$
BEGIN
 IF current_setting('lifeos.storage_review_note_approved',true) IS DISTINCT FROM '1'
 OR current_setting('lifeos.agent_expected_database',true) IS DISTINCT FROM current_database()
 OR current_setting('lifeos.agent_expected_owner',true) IS DISTINCT FROM (SELECT owner_id FROM lifeos_agent.key_management_binding)
 OR current_setting('lifeos.agent_expected_space',true) IS DISTINCT FROM (SELECT space_id FROM lifeos_agent.key_management_binding)
 OR (SELECT count(*) FROM lifeos_agent.key_management_binding)<>1
 OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap','lifeos_agent_issuer','lifeos_agent_verifier','lifeos_agent_key_manager')
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.apikey'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.business_policy_operation'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.oauth_business_operation'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR to_regprocedure('lifeos_agent.assert_current_business_grant(text,text,text,text[],text,text)') IS NULL
 OR to_regprocedure('lifeos_agent.assert_oauth_business_grant(text,text,text,jsonb,text[],text)') IS NULL
 OR (SELECT count(*) FROM lifeos_agent.business_policy_operation WHERE operation_id IN
  ('snapshotStorageReviews','getStorageReview','createStorageReview','updateStorageReviewChecklist','updateStorageReviewDecision'))<>5
 THEN RAISE EXCEPTION 'Explicit storage-note target approval and the original owning policy/OAuth migration role required'; END IF;
END
$$;
-- Explicit false, even if a future table default changes. Existing operation states stay intact.
INSERT INTO lifeos_agent.business_policy_operation(operation_id,required_scopes,enabled) VALUES
 ('updateStorageReviewNote',ARRAY['storage-review:read','storage-review:write'],false);
INSERT INTO lifeos_agent.oauth_business_operation(operation_id,required_scopes) VALUES
 ('updateStorageReviewNote',ARRAY['storage-review:read','storage-review:write']);
COMMIT;
-- No DROP rollback: leave the new business-policy operation disabled and retain audit/history.
