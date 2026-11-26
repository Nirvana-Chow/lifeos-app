-- Article-only fence. This migration creates no credentials and enables no capabilities.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
DO $$
BEGIN
 IF current_setting('lifeos.article_agent_migration_approved',true) IS DISTINCT FROM '1'
 OR current_setting('lifeos.agent_expected_database',true) IS DISTINCT FROM current_database()
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.apikey'::regclass)
    IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_agent_verifier','lifeos_agent_issuer','lifeos_agent_key_manager')
 THEN RAISE EXCEPTION 'Explicit article target approval and the original owning migration role required'; END IF;
END
$$;

CREATE FUNCTION lifeos_agent.assert_article_grant(grant_id text, expected_owner text, expected_space text, requested text[], operation_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE
  grant_row lifeos_agent.apikey%ROWTYPE;
  permissions jsonb;
BEGIN
  IF expected_owner IS NULL OR expected_owner='' OR expected_space IS NULL OR expected_space=''
     OR NOT COALESCE(
       (operation_id IN ('snapshotArticle','getArticle') AND requested=ARRAY['article:read'])
       OR (operation_id IN ('createArticle','updateArticle') AND requested=ARRAY['article:read','article:write']),
       false
     ) THEN RETURN false; END IF;
  SELECT * INTO grant_row FROM lifeos_agent.apikey WHERE id=grant_id FOR SHARE;
  IF NOT FOUND OR grant_row."referenceId"<>expected_owner OR grant_row.enabled IS DISTINCT FROM true
     OR grant_row."expiresAt" IS NULL OR grant_row."expiresAt"<=clock_timestamp()
     OR grant_row.metadata::jsonb IS DISTINCT FROM jsonb_build_object('spaceId',expected_space,'articleAccess','article-v1')
  THEN RETURN false; END IF;
  permissions := grant_row.permissions::jsonb;
  RETURN COALESCE(permissions='{"article":["read","write"]}'::jsonb
     OR (requested=ARRAY['article:read'] AND permissions='{"article":["read"]}'::jsonb),false);
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END
$$;
REVOKE ALL ON FUNCTION lifeos_agent.assert_article_grant(text,text,text,text[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lifeos_agent.assert_article_grant(text,text,text,text[],text) TO lifeos_platform_candidate_runtime;
COMMIT;
