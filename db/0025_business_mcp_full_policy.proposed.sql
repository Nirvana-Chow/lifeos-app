-- LO-AGENT-001. Proposed source only; no build/start/route applies this migration.
-- Explicit full-policy OAuth consent is separate from all existing narrow tokens.
-- Original0016/0021/0023/0024 functions and existing enabled states are retained.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
DO $$ BEGIN
 IF current_setting('lifeos.business_mcp_policy_approved',true) IS DISTINCT FROM 'all-personal-business-v1'
 OR current_setting('lifeos.agent_expected_database',true) IS DISTINCT FROM current_database()
 OR (SELECT count(*) FROM lifeos_agent.key_management_binding)<>1
 OR current_setting('lifeos.agent_expected_owner',true) IS DISTINCT FROM (SELECT owner_id FROM lifeos_agent.key_management_binding)
 OR current_setting('lifeos.agent_expected_space',true) IS DISTINCT FROM (SELECT space_id FROM lifeos_agent.key_management_binding)
 OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap','lifeos_agent_issuer','lifeos_agent_verifier','lifeos_agent_key_manager')
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.apikey'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.business_policy_operation'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.oauth_business_operation'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR to_regprocedure('lifeos_agent.assert_current_business_grant(text,text,text,text[],text,text)') IS NULL
 OR to_regprocedure('lifeos_agent.read_oauth_business_token(text,text,text)') IS NULL
 OR to_regclass('lifeos_platform.platform_classification_plan') IS NULL
 OR to_regprocedure('lifeos_platform.classification_immutable()') IS NULL
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_platform.platform_classification_plan'::regclass) IS DISTINCT FROM (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.apikey'::regclass)
 OR to_regprocedure('lifeos_agent.oauth_policy_version()') IS NOT NULL
 THEN RAISE EXCEPTION 'Explicit exact-target policy approval and original owning migration role required';END IF;
END $$;
SELECT pg_advisory_xact_lock(hashtextextended('lifeos-business-mcp-oauth-v1',0));
LOCK TABLE lifeos_agent.business_policy_operation,lifeos_agent.oauth_business_operation IN SHARE ROW EXCLUSIVE MODE;

-- Reviewed source-registry snapshot. Missing registrations are default disabled.
-- Exact existing scopes/enabled values are retained; a mismatch is not repaired.
-- File authority, engineering and owner-approved commits remain separate.
DO $register$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('snapshotJournal',ARRAY['journal:read']::text[]),
  ('getJournal',ARRAY['journal:read']::text[]),
  ('createJournal',ARRAY['journal:read','journal:write']::text[]),
  ('updateJournal',ARRAY['journal:read','journal:write']::text[]),
  ('snapshotCalendar',ARRAY['calendar:read']::text[]),
  ('getCalendar',ARRAY['calendar:read']::text[]),
  ('createCalendar',ARRAY['calendar:read','calendar:write']::text[]),
  ('updateCalendar',ARRAY['calendar:read','calendar:write']::text[]),
  ('snapshotHealth',ARRAY['health:read']::text[]),
  ('getHealth',ARRAY['health:read']::text[]),
  ('createHealth',ARRAY['health:read','health:write']::text[]),
  ('updateHealth',ARRAY['health:read','health:write']::text[]),
  ('snapshotPerson',ARRAY['person:read']::text[]),
  ('getPerson',ARRAY['person:read']::text[]),
  ('createPerson',ARRAY['person:read','person:write']::text[]),
  ('updatePerson',ARRAY['person:read','person:write']::text[]),
  ('snapshotFinance',ARRAY['finance:read']::text[]),
  ('getFinance',ARRAY['finance:read']::text[]),
  ('createFinance',ARRAY['finance:read','finance:write']::text[]),
  ('updateFinance',ARRAY['finance:read','finance:write']::text[]),
  ('snapshotMedia',ARRAY['media:read']::text[]),
  ('getMedia',ARRAY['media:read']::text[]),
  ('createMedia',ARRAY['media:read','media:write']::text[]),
  ('updateMedia',ARRAY['media:read','media:write']::text[]),
  ('snapshotCareer',ARRAY['career:read']::text[]),
  ('getCareer',ARRAY['career:read']::text[]),
  ('createCareer',ARRAY['career:read','career:write']::text[]),
  ('updateCareer',ARRAY['career:read','career:write']::text[]),
  ('snapshotPortfolio',ARRAY['portfolio:read']::text[]),
  ('getPortfolio',ARRAY['portfolio:read']::text[]),
  ('createPortfolio',ARRAY['portfolio:read','portfolio:write']::text[]),
  ('updatePortfolio',ARRAY['portfolio:read','portfolio:write']::text[]),
  ('snapshotCooking',ARRAY['cooking:read']::text[]),
  ('getCooking',ARRAY['cooking:read']::text[]),
  ('createCooking',ARRAY['cooking:read','cooking:write']::text[]),
  ('updateCooking',ARRAY['cooking:read','cooking:write']::text[]),
  ('snapshotFeedback',ARRAY['feedback:read']::text[]),
  ('getFeedback',ARRAY['feedback:read']::text[]),
  ('createFeedback',ARRAY['feedback:read','feedback:write']::text[]),
  ('snapshotStorageReviews',ARRAY['storage-review:read']::text[]),
  ('getStorageReview',ARRAY['storage-review:read']::text[]),
  ('createStorageReview',ARRAY['storage-review:read','storage-review:write']::text[]),
  ('updateStorageReviewChecklist',ARRAY['storage-review:read','storage-review:write']::text[]),
  ('updateStorageReviewDecision',ARRAY['storage-review:read','storage-review:write']::text[]),
  ('updateStorageReviewNote',ARRAY['storage-review:read','storage-review:write']::text[]),
  ('snapshotRequirements',ARRAY['requirements:read']::text[]),
  ('getRequirement',ARRAY['requirements:read']::text[]),
  ('createRequirement',ARRAY['requirements:read','requirements:write']::text[]),
  ('updateRequirement',ARRAY['requirements:read','requirements:write']::text[]),
  ('listTodos',ARRAY['todo:read']::text[]),
  ('snapshotTodos',ARRAY['todo:read']::text[]),
  ('getTodo',ARRAY['todo:read']::text[]),
  ('createTodo',ARRAY['todo:write']::text[]),
  ('updateTodo',ARRAY['todo:write']::text[]),
  ('snapshotOrganization',ARRAY['organization:read']::text[]),
  ('getOrganization',ARRAY['organization:read']::text[]),
  ('createOrganization',ARRAY['organization:read','organization:write']::text[]),
  ('updateOrganization',ARRAY['organization:read','organization:write']::text[]),
  ('previewTodoClassification',ARRAY['todo:read','organization:read']::text[])
 ) reviewed(operation_id,required_scopes) LOOP
  IF EXISTS(SELECT 1 FROM lifeos_agent.business_policy_operation b WHERE b.operation_id=r.operation_id AND b.required_scopes IS DISTINCT FROM r.required_scopes)
  OR EXISTS(SELECT 1 FROM lifeos_agent.oauth_business_operation b WHERE b.operation_id=r.operation_id AND b.required_scopes IS DISTINCT FROM r.required_scopes)
  THEN RAISE EXCEPTION 'Reviewed operation registration mismatch';END IF;
  INSERT INTO lifeos_agent.business_policy_operation(operation_id,required_scopes,enabled)
   SELECT r.operation_id,r.required_scopes,false WHERE NOT EXISTS(SELECT 1 FROM lifeos_agent.business_policy_operation b WHERE b.operation_id=r.operation_id);
  INSERT INTO lifeos_agent.oauth_business_operation(operation_id,required_scopes)
   SELECT r.operation_id,r.required_scopes WHERE r.operation_id<>'previewTodoClassification'
    AND NOT EXISTS(SELECT 1 FROM lifeos_agent.oauth_business_operation b WHERE b.operation_id=r.operation_id);
 END LOOP;
END $register$;

CREATE FUNCTION lifeos_agent.valid_policy_oauth_scopes(ss text[]) RETURNS boolean
 LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT ss IS NOT NULL AND cardinality(ss)>0
 AND cardinality(ss)=(SELECT count(DISTINCT x) FROM unnest(ss)x)
 AND ss<@ARRAY['personal-business:all','offline_access','file-handoff:read','file-handoff:write']::text[]
 AND ('personal-business:all'=ANY(ss) OR 'file-handoff:read'=ANY(ss))
 AND (NOT 'file-handoff:write'=ANY(ss) OR 'file-handoff:read'=ANY(ss))
$$;

-- Bounded nonsecret authority projection: never selects an API key/digest or credentials.
CREATE FUNCTION lifeos_agent.oauth_policy_original_ready(g text,o text,s text) RETURNS boolean
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM lifeos_agent.apikey k WHERE k.id=g AND k.enabled IS TRUE
  AND k."referenceId"=o AND k.metadata::jsonb->>'spaceId'=s
  AND k.metadata::jsonb->>'businessDataPolicy'='all-personal-business-v1'
  AND k."expiresAt" IS NOT NULL AND k."expiresAt">clock_timestamp()
  AND lifeos_agent.valid_business_permissions(k.permissions::jsonb))
 AND EXISTS(SELECT 1 FROM lifeos_agent.business_policy_control WHERE singleton AND enabled)
$$;

-- Private revision for the original plan's existing token-shaped field. The
-- prefix makes a missing OAuth ledger fail closed instead of becoming a key plan.
-- Only the authenticated current-state reader may use this helper.
CREATE FUNCTION lifeos_agent.oauth_policy_producer_revision(g text,o text,s text,fence jsonb) RETURNS text
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT CASE WHEN d IS NOT NULL THEN 'classification-oauth-v1:'||encode(sha256(convert_to(
  jsonb_build_object('version','classification-oauth-v1','grantId',g,'ownerId',o,'spaceId',s,'grantDigest',d,'oauthFence',fence)::text,'UTF8')),'hex') END
 FROM(SELECT lifeos_agent.current_managed_grant_digest(g) AS d) current_grant
$$;

CREATE FUNCTION lifeos_agent.read_policy_oauth_business_token(token_id text,o text,s text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v jsonb;ss text[];BEGIN
 v:=lifeos_agent.read_oauth_business_token(token_id,o,s);
 IF v IS NULL THEN RETURN NULL;END IF;
 SELECT array_agg(value) INTO ss FROM jsonb_array_elements_text(v->'scopes') AS scopes(value);
 IF lifeos_agent.valid_policy_oauth_scopes(ss) IS NOT TRUE THEN RETURN NULL;END IF;
 IF 'personal-business:all'=ANY(ss) THEN
  IF lifeos_agent.oauth_policy_original_ready(v->>'grantId',o,s) IS NOT TRUE THEN RETURN NULL;END IF;
  v:=jsonb_set(v,'{oauthFence,policy}',to_jsonb('all-personal-business-v1'::text));
  RETURN v||jsonb_build_object('producerAuthorizationRevision',lifeos_agent.oauth_policy_producer_revision(v->>'grantId',o,s,v->'oauthFence'));
 END IF;
 -- A separately requested file-only consent stays narrow.
 RETURN v;
END $$;

CREATE FUNCTION lifeos_agent.assert_oauth_classification_producer(g text,o text,s text,fence jsonb,producer_revision text) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('lifeos-business-mcp-oauth-v1',0));
 IF lifeos_agent.assert_policy_oauth_business_grant(g,o,s,fence,ARRAY['todo:read','organization:read']::text[],'previewTodoClassification') IS NOT TRUE THEN RETURN false;END IF;
 v:=lifeos_agent.read_policy_oauth_business_token(fence->>'tokenId',o,s);
 RETURN v IS NOT NULL AND producer_revision IS NOT NULL AND producer_revision~'^classification-oauth-v1:[a-f0-9]{64}$'
  AND v->>'producerAuthorizationRevision'=producer_revision;
END $$;

-- Original plan JSON, validator, wire and three tables are unchanged. This
-- immutable metadata row is inserted by the same original runtime transaction.
CREATE TABLE lifeos_platform.platform_classification_oauth_producer(
 owner_id text NOT NULL,space_id text NOT NULL,plan_id uuid NOT NULL,digest text NOT NULL,
 proposal_revision integer NOT NULL CHECK(proposal_revision=1),grant_id text NOT NULL,
 expires_at timestamptz NOT NULL,producer_authorization_revision text NOT NULL,oauth_fence jsonb NOT NULL,
 PRIMARY KEY(owner_id,space_id,plan_id),
 FOREIGN KEY(owner_id,space_id,plan_id,digest,proposal_revision)
  REFERENCES lifeos_platform.platform_classification_plan(owner_id,space_id,plan_id,digest,proposal_revision)
);
CREATE FUNCTION lifeos_platform.classification_oauth_insert_binding() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE p jsonb;BEGIN
 SELECT plan INTO p FROM lifeos_platform.platform_classification_plan
 WHERE owner_id=NEW.owner_id AND space_id=NEW.space_id AND plan_id=NEW.plan_id;
 IF p IS NULL OR p->>'grantId' IS DISTINCT FROM NEW.grant_id
 OR p#>>'{preview,digest}' IS DISTINCT FROM NEW.digest
 OR p->'proposalRevision' IS DISTINCT FROM to_jsonb(NEW.proposal_revision)
 OR p->>'producerAuthorizationRevision' IS DISTINCT FROM NEW.producer_authorization_revision
 OR (p#>>'{preview,expiresAt}')::timestamptz IS DISTINCT FROM NEW.expires_at
 OR NEW.expires_at<=clock_timestamp()
 OR NEW.expires_at>to_timestamp((NEW.oauth_fence->>'expiresAt')::double precision)
 OR lifeos_agent.assert_oauth_classification_producer(NEW.grant_id,NEW.owner_id,NEW.space_id,NEW.oauth_fence,NEW.producer_authorization_revision) IS NOT TRUE
 THEN RAISE EXCEPTION 'Classification OAuth producer binding invalid' USING ERRCODE='LG403';END IF;
 RETURN NEW;
END $$;
ALTER TABLE lifeos_platform.platform_classification_oauth_producer ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.platform_classification_oauth_producer FORCE ROW LEVEL SECURITY;
REVOKE ALL ON lifeos_platform.platform_classification_oauth_producer FROM PUBLIC,lifeos_platform_candidate_runtime,lifeos_platform_candidate_bootstrap,lifeos_agent_key_manager,lifeos_agent_verifier,lifeos_agent_issuer;
GRANT SELECT,INSERT ON lifeos_platform.platform_classification_oauth_producer TO lifeos_platform_candidate_runtime;
CREATE POLICY classification_oauth_read ON lifeos_platform.platform_classification_oauth_producer FOR SELECT TO lifeos_platform_candidate_runtime
 USING(owner_id=current_setting('lifeos.owner_id',true) AND space_id=current_setting('lifeos.classification_space_id',true));
CREATE POLICY classification_oauth_insert ON lifeos_platform.platform_classification_oauth_producer FOR INSERT TO lifeos_platform_candidate_runtime
 WITH CHECK(owner_id=current_setting('lifeos.owner_id',true) AND space_id=current_setting('lifeos.classification_space_id',true));
CREATE TRIGGER classification_oauth_binding BEFORE INSERT ON lifeos_platform.platform_classification_oauth_producer FOR EACH ROW EXECUTE FUNCTION lifeos_platform.classification_oauth_insert_binding();
CREATE TRIGGER classification_oauth_immutable BEFORE UPDATE OR DELETE ON lifeos_platform.platform_classification_oauth_producer FOR EACH ROW EXECUTE FUNCTION lifeos_platform.classification_immutable();

CREATE FUNCTION lifeos_agent.approve_policy_oauth_business_binding(session_id text,g text,o text,s text,client_id text,approved_scopes text[]) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE accepted boolean;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('lifeos-business-mcp-oauth-v1',0));
 IF lifeos_agent.valid_policy_oauth_scopes(approved_scopes) IS NOT TRUE THEN RETURN false;END IF;
 IF 'personal-business:all'=ANY(approved_scopes) AND lifeos_agent.oauth_policy_original_ready(g,o,s) IS NOT TRUE THEN RETURN false;END IF;
 IF approved_scopes&&ARRAY['file-handoff:read','file-handoff:write']::text[] THEN
  IF to_regprocedure('lifeos_agent.approve_file_handoff_oauth_binding(text,text,text,text,text,text[])') IS NULL THEN RETURN false;END IF;
  accepted:=lifeos_agent.approve_file_handoff_oauth_binding(session_id,g,o,s,client_id,approved_scopes);
 ELSE accepted:=lifeos_agent.approve_oauth_business_binding(session_id,g,o,s,client_id,approved_scopes);
 END IF;
 IF accepted AND 'personal-business:all'=ANY(approved_scopes) AND lifeos_agent.oauth_policy_original_ready(g,o,s) IS NOT TRUE
 THEN RAISE EXCEPTION 'Current original business policy unavailable' USING ERRCODE='LG403';END IF;
 RETURN accepted;
END $$;

CREATE FUNCTION lifeos_agent.register_policy_oauth_business_token(g text,o text,s text,token_id text,claims jsonb,grant_type text) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE ss text[];v jsonb;BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('lifeos-business-mcp-oauth-v1',0));
 ss:=string_to_array(claims->>'scope',' ');
 IF lifeos_agent.valid_policy_oauth_scopes(ss) IS NOT TRUE THEN RETURN NULL;END IF;
 IF 'personal-business:all'=ANY(ss) AND lifeos_agent.oauth_policy_original_ready(g,o,s) IS NOT TRUE THEN RETURN NULL;END IF;
 IF ss&&ARRAY['file-handoff:read','file-handoff:write']::text[] THEN
  IF to_regprocedure('lifeos_agent.register_file_handoff_oauth_token(text,text,text,text,jsonb,text)') IS NULL THEN RETURN NULL;END IF;
  v:=lifeos_agent.register_file_handoff_oauth_token(g,o,s,token_id,claims,grant_type);
 ELSE v:=lifeos_agent.register_oauth_business_token(g,o,s,token_id,claims,grant_type);
 END IF;
 IF v IS NULL THEN RETURN NULL;END IF;
 v:=lifeos_agent.read_policy_oauth_business_token(token_id,o,s);
 IF v IS NULL THEN RAISE EXCEPTION 'Current original business policy unavailable' USING ERRCODE='LG403';END IF;
 RETURN v;
END $$;

CREATE FUNCTION lifeos_agent.assert_policy_oauth_business_grant(g text,o text,s text,fence jsonb,required_scopes text[],operation_id text) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v jsonb;BEGIN
 v:=lifeos_agent.read_policy_oauth_business_token(fence->>'tokenId',o,s);
 IF v IS NULL OR v->>'grantId' IS DISTINCT FROM g OR v->'oauthFence' IS DISTINCT FROM fence
 OR operation_id IS NULL OR required_scopes IS NULL OR cardinality(required_scopes)=0 THEN RETURN false;END IF;
 IF NOT v->'scopes' @> to_jsonb(ARRAY['personal-business:all']::text[]) THEN
  RETURN lifeos_agent.assert_oauth_business_grant(g,o,s,fence,required_scopes,operation_id);
 END IF;
 IF fence->>'policy' IS DISTINCT FROM 'all-personal-business-v1' THEN RETURN false;END IF;
 IF required_scopes&&ARRAY['file-handoff:read','file-handoff:write']::text[] THEN
  -- The original file permission/revision fence is still required by the writer.
  RETURN lifeos_agent.assert_oauth_business_grant(g,o,s,fence-'policy',required_scopes,operation_id);
 END IF;
 -- Preview is new only in this explicit full-policy version. Do not add it to
 -- the old narrow OAuth operation registry or rewrite its original validator.
 IF operation_id='previewTodoClassification' THEN
  IF required_scopes IS DISTINCT FROM ARRAY['todo:read','organization:read']::text[] THEN RETURN false;END IF;
 ELSIF NOT EXISTS(SELECT 1 FROM lifeos_agent.oauth_business_operation r
  WHERE r.operation_id=assert_policy_oauth_business_grant.operation_id
  AND r.required_scopes<@assert_policy_oauth_business_grant.required_scopes) THEN RETURN false;END IF;
 RETURN lifeos_agent.assert_current_business_grant(g,o,s,required_scopes,'all-personal-business-v1',operation_id);
END $$;

CREATE FUNCTION lifeos_agent.oauth_policy_version() RETURNS text
 LANGUAGE sql SET search_path=pg_catalog,pg_temp AS $$SELECT 'business-mcp-policy-v1'::text$$;
CREATE FUNCTION lifeos_agent.oauth_policy_activation_ready(g text,o text,s text) RETURNS boolean
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM lifeos_agent.oauth_business_control c WHERE c.singleton AND c.enabled
 AND (c.grant_id,c.owner_id,c.space_id)=(g,o,s)
 AND lifeos_agent.valid_policy_oauth_scopes(c.scopes) IS TRUE AND 'personal-business:all'=ANY(c.scopes))
 AND lifeos_agent.oauth_policy_original_ready(g,o,s)
$$;

REVOKE ALL ON FUNCTION lifeos_agent.valid_policy_oauth_scopes(text[]),lifeos_agent.oauth_policy_original_ready(text,text,text),lifeos_agent.read_policy_oauth_business_token(text,text,text),lifeos_agent.approve_policy_oauth_business_binding(text,text,text,text,text,text[]),lifeos_agent.register_policy_oauth_business_token(text,text,text,text,jsonb,text),lifeos_agent.assert_policy_oauth_business_grant(text,text,text,jsonb,text[],text),lifeos_agent.oauth_policy_version(),lifeos_agent.oauth_policy_activation_ready(text,text,text) FROM PUBLIC,lifeos_platform_candidate_runtime,lifeos_platform_candidate_bootstrap,lifeos_agent_key_manager,lifeos_agent_verifier,lifeos_agent_issuer;
REVOKE ALL ON FUNCTION lifeos_agent.oauth_policy_producer_revision(text,text,text,jsonb),lifeos_agent.assert_oauth_classification_producer(text,text,text,jsonb,text),lifeos_platform.classification_oauth_insert_binding() FROM PUBLIC,lifeos_platform_candidate_runtime,lifeos_platform_candidate_bootstrap,lifeos_agent_key_manager,lifeos_agent_verifier,lifeos_agent_issuer;
GRANT EXECUTE ON FUNCTION lifeos_agent.read_policy_oauth_business_token(text,text,text),lifeos_agent.approve_policy_oauth_business_binding(text,text,text,text,text,text[]),lifeos_agent.register_policy_oauth_business_token(text,text,text,text,jsonb,text),lifeos_agent.assert_policy_oauth_business_grant(text,text,text,jsonb,text[],text),lifeos_agent.oauth_policy_version(),lifeos_agent.oauth_policy_activation_ready(text,text,text) TO lifeos_platform_candidate_runtime;
GRANT EXECUTE ON FUNCTION lifeos_agent.assert_oauth_classification_producer(text,text,text,jsonb,text),lifeos_platform.classification_oauth_insert_binding() TO lifeos_platform_candidate_runtime;
COMMIT;
-- No destructive rollback: retain new functions/audit, disable full-policy configuration
-- through its separate current-instance/digest-CAS control path before changing flags.
