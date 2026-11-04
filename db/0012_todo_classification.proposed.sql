-- Proposed only: never executed at application startup. Explicit exact-target
-- approval plus qualified 0011/schema2 and an independent migration owner.
-- No roles, credentials, current key scope changes, or business record migration.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
DO $$
BEGIN
 IF current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap','lifeos_agent_issuer','lifeos_agent_verifier','lifeos_agent_key_manager')
    OR current_setting('lifeos.todo_classification_approved',true) IS DISTINCT FROM '1'
    OR current_setting('lifeos.agent_expected_database',true) IS DISTINCT FROM current_database() THEN
  RAISE EXCEPTION 'Explicit exact-target approval and independent migration owner required';
 END IF;
 IF to_regprocedure('lifeos_agent.assert_business_grant(text,text,text,text[])') IS NULL
    OR to_regprocedure('lifeos_agent.set_managed_grant_scopes(text,text,text,jsonb)') IS NULL
    OR to_regclass('lifeos_agent.key_management_binding') IS NULL
    OR to_regclass('lifeos_platform.platform_two_factor') IS NULL
    OR (SELECT version FROM lifeos_platform.platform_meta) IS DISTINCT FROM 2
    OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.apikey'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
    OR (SELECT relowner FROM pg_class WHERE oid='lifeos_platform.platform_record'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
    OR (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lifeos_platform' AND c.relname IN ('platform_source','platform_record','platform_history','platform_command') AND c.relrowsecurity AND c.relforcerowsecurity)<>4
    OR (SELECT count(*) FROM pg_roles WHERE rolname IN ('lifeos_platform_candidate_runtime','lifeos_agent_verifier','lifeos_agent_key_manager'))<>3
    OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN ('lifeos_platform_candidate_runtime','lifeos_agent_verifier','lifeos_agent_key_manager') AND (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolreplication OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid))) THEN
  RAISE EXCEPTION 'Qualified 0011 and restricted schema2 prerequisites required';
 END IF;
END
$$;

CREATE FUNCTION lifeos_platform.classification_keys(v jsonb,keys text[],optional text[] DEFAULT ARRAY[]::text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT COALESCE(jsonb_typeof(v)='object' AND v?&keys AND v-(keys||optional)='{}'::jsonb,false)
$$;
CREATE FUNCTION lifeos_platform.classification_canonical(v jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE result text;
BEGIN
 CASE jsonb_typeof(v)
 WHEN 'object' THEN SELECT '{'||COALESCE(string_agg(to_jsonb(key)::text||':'||lifeos_platform.classification_canonical(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(v);
 WHEN 'array' THEN SELECT '['||COALESCE(string_agg(lifeos_platform.classification_canonical(value),',' ORDER BY ord),'')||']' INTO result FROM jsonb_array_elements(v) WITH ORDINALITY AS a(value,ord);
 ELSE result:=v::text;
 END CASE;
 RETURN result;
END
$$;
CREATE FUNCTION lifeos_platform.classification_hash(v jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT encode(sha256(convert_to(lifeos_platform.classification_canonical(v),'UTF8')),'hex')
$$;
CREATE FUNCTION lifeos_platform.classification_bindings(p jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT lifeos_platform.classification_hash(jsonb_build_object('ownerId',p->'ownerId','spaceId',p->'spaceId','planId',p#>'{preview,planId}','digest',p#>'{preview,digest}','proposalRevision',p->'proposalRevision','grantId',p->'grantId','producerAuthorizationRevision',p->'producerAuthorizationRevision','policyRevision',p->'policyRevision'))
$$;
-- Strict recursive operation JSON: no title/notes/content or unknown keys.
-- Exception handling closes invalid scalar casts rather than accepting NULL CHECKs.
CREATE FUNCTION lifeos_platform.classification_valid(v jsonb,shape text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE item jsonb; expected jsonb; seen text[]:=ARRAY[]::text[]; result boolean:=false; created timestamptz; expires timestamptz;
BEGIN
 IF v IS NULL THEN RETURN false; END IF;
 CASE shape
 WHEN 'uuid' THEN result:=jsonb_typeof(v)='string' AND v#>>'{}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
 WHEN 'token' THEN result:=jsonb_typeof(v)='string' AND v#>>'{}' ~ '^[A-Za-z0-9_.:-]{1,160}$';
 WHEN 'digest' THEN result:=jsonb_typeof(v)='string' AND v#>>'{}' ~ '^[a-f0-9]{64}$';
 WHEN 'revision' THEN result:=jsonb_typeof(v)='number' AND v::text ~ '^[1-9][0-9]*$' AND (v::text)::numeric<=2147483647;
 WHEN 'iso' THEN result:=jsonb_typeof(v)='string' AND v#>>'{}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' AND to_char((v#>>'{}')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')=v#>>'{}';
 WHEN 'reference' THEN result:=lifeos_platform.classification_keys(v,ARRAY['id','sourceId','revision']) AND lifeos_platform.classification_valid(v->'id','uuid') AND lifeos_platform.classification_valid(v->'sourceId','uuid') AND lifeos_platform.classification_valid(v->'revision','revision');
 WHEN 'relations' THEN
  IF NOT lifeos_platform.classification_keys(v,ARRAY['project','domain','topics']) OR jsonb_typeof(v->'topics')<>'array' OR jsonb_array_length(v->'topics')>20 THEN RETURN false; END IF;
  IF v->'project'<>'null'::jsonb AND NOT lifeos_platform.classification_valid(v->'project','reference') OR v->'domain'<>'null'::jsonb AND NOT lifeos_platform.classification_valid(v->'domain','reference') THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(v->'topics') LOOP
   IF NOT lifeos_platform.classification_valid(item,'reference') OR item->>'id'=ANY(seen) THEN RETURN false; END IF; seen:=array_append(seen,item->>'id');
  END LOOP;result:=true;
 WHEN 'todo' THEN result:=lifeos_platform.classification_keys(v,ARRAY['id','sourceId','expectedRevision']) AND lifeos_platform.classification_valid(v->'id','uuid') AND lifeos_platform.classification_valid(v->'sourceId','uuid') AND lifeos_platform.classification_valid(v->'expectedRevision','revision');
 WHEN 'changes' THEN
  IF jsonb_typeof(v)<>'array' OR jsonb_array_length(v) NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(v) LOOP
   IF NOT lifeos_platform.classification_keys(item,ARRAY['todo','before','after']) OR NOT lifeos_platform.classification_valid(item->'todo','todo') OR (item->'before'<>'null'::jsonb AND NOT lifeos_platform.classification_valid(item->'before','relations')) OR NOT lifeos_platform.classification_valid(item->'after','relations') OR item#>>'{todo,id}'=ANY(seen) THEN RETURN false; END IF;
   seen:=array_append(seen,item#>>'{todo,id}');
  END LOOP;result:=true;
 WHEN 'ids' THEN
  IF jsonb_typeof(v)<>'array' OR jsonb_array_length(v)>100 THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(v) LOOP
   IF NOT lifeos_platform.classification_valid(item,'uuid') OR item#>>'{}'=ANY(seen) THEN RETURN false; END IF;seen:=array_append(seen,item#>>'{}');
  END LOOP;result:=true;
 WHEN 'preview' THEN
  IF NOT lifeos_platform.classification_keys(v,ARRAY['planId','digest','expiresAt','changes','unchangedIds']) OR NOT lifeos_platform.classification_valid(v->'planId','uuid') OR NOT lifeos_platform.classification_valid(v->'digest','digest') OR NOT lifeos_platform.classification_valid(v->'expiresAt','iso') OR NOT lifeos_platform.classification_valid(v->'changes','changes') OR NOT lifeos_platform.classification_valid(v->'unchangedIds','ids') THEN RETURN false; END IF;
  SELECT COALESCE(jsonb_agg(value#>'{todo,id}' ORDER BY ord),'[]'::jsonb) INTO expected FROM jsonb_array_elements(v->'changes') WITH ORDINALITY a(value,ord) WHERE COALESCE(NULLIF(value->'before','null'::jsonb),'{"project":null,"domain":null,"topics":[]}'::jsonb)=value->'after';
  result:=v->'unchangedIds'=expected;
 WHEN 'plan' THEN
  IF octet_length(lifeos_platform.classification_canonical(v))>131072 OR NOT lifeos_platform.classification_keys(v,ARRAY['schemaVersion','proposalRevision','ownerId','spaceId','grantId','producerAuthorizationRevision','policyRevision','createdAt','preview'],ARRAY['runProvenance','referenceObservationDigest']) OR v->'schemaVersion'<>'1'::jsonb OR v->'proposalRevision'<>'1'::jsonb OR NOT lifeos_platform.classification_valid(v->'ownerId','token') OR NOT lifeos_platform.classification_valid(v->'spaceId','token') OR NOT lifeos_platform.classification_valid(v->'policyRevision','token') OR NOT lifeos_platform.classification_valid(v->'createdAt','iso') OR NOT lifeos_platform.classification_valid(v->'preview','preview') THEN RETURN false; END IF;
  IF (v->'grantId'='null'::jsonb)<>(v->'producerAuthorizationRevision'='null'::jsonb) OR (v->'grantId'<>'null'::jsonb AND (NOT lifeos_platform.classification_valid(v->'grantId','token') OR NOT lifeos_platform.classification_valid(v->'producerAuthorizationRevision','token'))) THEN RETURN false; END IF;
  IF v?'runProvenance' AND (NOT lifeos_platform.classification_keys(v->'runProvenance',ARRAY['runId','capabilityRef']) OR NOT lifeos_platform.classification_valid(v#>'{runProvenance,runId}','token') OR NOT lifeos_platform.classification_valid(v#>'{runProvenance,capabilityRef}','token')) THEN RETURN false; END IF;
  IF v?'referenceObservationDigest' AND NOT lifeos_platform.classification_valid(v->'referenceObservationDigest','digest') THEN RETURN false; END IF;
  created:=(v->>'createdAt')::timestamptz;expires:=(v#>>'{preview,expiresAt}')::timestamptz;
  result:=expires>created AND expires<=created+interval '30 minutes' AND v#>>'{preview,digest}'=lifeos_platform.classification_hash(v#-'{preview,digest}');
 WHEN 'approval' THEN result:=octet_length(lifeos_platform.classification_canonical(v))<=131072 AND lifeos_platform.classification_keys(v,ARRAY['planId','proposalRevision','digest','operationIds','bindingsDigest','producerAuthorizationRevision','policyRevision','approvedAt','expiresAt']) AND lifeos_platform.classification_valid(v->'planId','uuid') AND v->'proposalRevision'='1'::jsonb AND lifeos_platform.classification_valid(v->'digest','digest') AND v->'operationIds'='["commitTodoClassification"]'::jsonb AND lifeos_platform.classification_valid(v->'bindingsDigest','digest') AND (v->'producerAuthorizationRevision'='null'::jsonb OR lifeos_platform.classification_valid(v->'producerAuthorizationRevision','token')) AND lifeos_platform.classification_valid(v->'policyRevision','token') AND lifeos_platform.classification_valid(v->'approvedAt','iso') AND lifeos_platform.classification_valid(v->'expiresAt','iso') AND (v->>'expiresAt')::timestamptz>(v->>'approvedAt')::timestamptz;
 WHEN 'entry' THEN result:=lifeos_platform.classification_keys(v,ARRAY['id','sourceId','revision','personal']) AND lifeos_platform.classification_valid(v->'id','uuid') AND lifeos_platform.classification_valid(v->'sourceId','uuid') AND lifeos_platform.classification_valid(v->'revision','revision') AND (v->'personal'='null'::jsonb OR lifeos_platform.classification_valid(v->'personal','relations'));
 WHEN 'result' THEN
  IF NOT lifeos_platform.classification_keys(v,ARRAY['planId','digest','duplicate','entries','unchangedIds']) OR NOT lifeos_platform.classification_valid(v->'planId','uuid') OR NOT lifeos_platform.classification_valid(v->'digest','digest') OR v->'duplicate'<>'false'::jsonb OR jsonb_typeof(v->'entries')<>'array' OR jsonb_array_length(v->'entries') NOT BETWEEN 1 AND 100 OR NOT lifeos_platform.classification_valid(v->'unchangedIds','ids') THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(v->'entries') LOOP
   IF NOT lifeos_platform.classification_valid(item,'entry') OR item->>'id'=ANY(seen) THEN RETURN false; END IF;seen:=array_append(seen,item->>'id');
  END LOOP;
  result:=NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(v->'unchangedIds') a(id) WHERE NOT id=ANY(seen));
 WHEN 'receipt' THEN result:=octet_length(lifeos_platform.classification_canonical(v))<=131072 AND lifeos_platform.classification_keys(v,ARRAY['requestDigest','planId','result']) AND lifeos_platform.classification_valid(v->'requestDigest','digest') AND lifeos_platform.classification_valid(v->'planId','uuid') AND lifeos_platform.classification_valid(v->'result','result') AND v->'planId'=v#>'{result,planId}';
 END CASE;
 RETURN COALESCE(result,false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END
$$;

CREATE TABLE lifeos_platform.platform_classification_plan (
 owner_id text NOT NULL REFERENCES lifeos_platform.platform_user(id), space_id text NOT NULL,
 plan_id uuid NOT NULL, digest text NOT NULL, proposal_revision integer NOT NULL CHECK(proposal_revision=1),
 grant_id text REFERENCES lifeos_agent.apikey(id), plan jsonb NOT NULL,
 PRIMARY KEY(owner_id,space_id,plan_id), UNIQUE(owner_id,space_id,plan_id,digest,proposal_revision),
 CHECK(lifeos_platform.classification_valid(plan,'plan')),
 CHECK(plan->>'ownerId'=owner_id AND plan->>'spaceId'=space_id AND plan#>>'{preview,planId}'=plan_id::text AND plan#>>'{preview,digest}'=digest AND (plan->>'proposalRevision')::integer=proposal_revision AND (plan->>'grantId') IS NOT DISTINCT FROM grant_id)
);
CREATE TABLE lifeos_platform.platform_classification_approval (
 owner_id text NOT NULL REFERENCES lifeos_platform.platform_user(id), space_id text NOT NULL,
 plan_id uuid NOT NULL, digest text NOT NULL, proposal_revision integer NOT NULL, approval jsonb NOT NULL,
 PRIMARY KEY(owner_id,space_id,plan_id), UNIQUE(owner_id,space_id,plan_id,digest,proposal_revision),
 FOREIGN KEY(owner_id,space_id,plan_id,digest,proposal_revision) REFERENCES lifeos_platform.platform_classification_plan(owner_id,space_id,plan_id,digest,proposal_revision),
 CHECK(lifeos_platform.classification_valid(approval,'approval')),
 CHECK(approval->>'planId'=plan_id::text AND approval->>'digest'=digest AND (approval->>'proposalRevision')::integer=proposal_revision)
);
CREATE TABLE lifeos_platform.platform_classification_command (
 owner_id text NOT NULL REFERENCES lifeos_platform.platform_user(id), space_id text NOT NULL,
 command_key text NOT NULL CHECK(command_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$'),
 plan_id uuid NOT NULL, digest text NOT NULL, proposal_revision integer NOT NULL, receipt jsonb NOT NULL,
 PRIMARY KEY(owner_id,space_id,command_key), UNIQUE(owner_id,space_id,plan_id),
 FOREIGN KEY(owner_id,space_id,plan_id,digest,proposal_revision) REFERENCES lifeos_platform.platform_classification_approval(owner_id,space_id,plan_id,digest,proposal_revision),
 CHECK(lifeos_platform.classification_valid(receipt,'receipt')),
 CHECK(receipt->>'planId'=plan_id::text AND receipt#>>'{result,digest}'=digest AND proposal_revision=1)
);
-- Producer exists only on the plan. This controlled check verifies owner/space;
-- approvals/commands use mandatory composite plan FKs, never nullable grant FKs.
CREATE FUNCTION lifeos_platform.classification_producer_matches(grant_id text,owner_id text,space_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM lifeos_agent.apikey k WHERE k.id=grant_id AND k."referenceId"=owner_id AND k.metadata::jsonb->>'spaceId'=space_id AND k."configId"='default')
$$;
CREATE FUNCTION lifeos_platform.classification_insert_binding()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE p jsonb; change jsonb; entry jsonb; noop boolean; pos integer:=0;
BEGIN
 IF TG_TABLE_NAME='platform_classification_plan' THEN
  IF NEW.grant_id IS NOT NULL AND NOT lifeos_platform.classification_producer_matches(NEW.grant_id,NEW.owner_id,NEW.space_id) THEN RAISE EXCEPTION 'Classification producer binding invalid' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT plan INTO p FROM lifeos_platform.platform_classification_plan WHERE owner_id=NEW.owner_id AND space_id=NEW.space_id AND plan_id=NEW.plan_id;
  IF p IS NULL THEN RAISE EXCEPTION 'Classification plan binding invalid' USING ERRCODE='23503'; END IF;
  IF TG_TABLE_NAME='platform_classification_approval' THEN
   IF NEW.approval->>'bindingsDigest' IS DISTINCT FROM lifeos_platform.classification_bindings(p) OR NEW.approval->'producerAuthorizationRevision' IS DISTINCT FROM p->'producerAuthorizationRevision' OR NEW.approval->'policyRevision' IS DISTINCT FROM p->'policyRevision' OR NEW.approval->'expiresAt' IS DISTINCT FROM p#>'{preview,expiresAt}' OR (NEW.approval->>'approvedAt')::timestamptz<(p->>'createdAt')::timestamptz THEN RAISE EXCEPTION 'Classification approval binding invalid' USING ERRCODE='23514'; END IF;
  ELSE
   IF NEW.receipt#>'{result,unchangedIds}' IS DISTINCT FROM p#>'{preview,unchangedIds}' OR jsonb_array_length(NEW.receipt#>'{result,entries}')<>jsonb_array_length(p#>'{preview,changes}') THEN RAISE EXCEPTION 'Classification receipt binding invalid' USING ERRCODE='23514'; END IF;
   FOR change IN SELECT value FROM jsonb_array_elements(p#>'{preview,changes}') LOOP
    entry:=NEW.receipt#>ARRAY['result','entries',pos::text];pos:=pos+1;
    noop:=COALESCE(NULLIF(change->'before','null'::jsonb),'{"project":null,"domain":null,"topics":[]}'::jsonb)=change->'after';
    IF entry->'id' IS DISTINCT FROM change#>'{todo,id}' OR entry->'sourceId' IS DISTINCT FROM change#>'{todo,sourceId}' OR (entry->>'revision')::bigint IS DISTINCT FROM (change#>>'{todo,expectedRevision}')::bigint+(CASE WHEN noop THEN 0 ELSE 1 END) OR entry->'personal' IS DISTINCT FROM (CASE WHEN noop THEN change->'before' ELSE change->'after' END) THEN RAISE EXCEPTION 'Classification receipt entry invalid' USING ERRCODE='23514'; END IF;
   END LOOP;
  END IF;
 END IF;
 RETURN NEW;
END
$$;
CREATE FUNCTION lifeos_platform.classification_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Classification rows are immutable' USING ERRCODE='23514'; END
$$;
DO $$
DECLARE t text; signature text;
BEGIN
 FOREACH t IN ARRAY ARRAY['platform_classification_plan','platform_classification_approval','platform_classification_command'] LOOP
  EXECUTE format('ALTER TABLE lifeos_platform.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE lifeos_platform.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON lifeos_platform.%I FROM PUBLIC,lifeos_platform_candidate_runtime,lifeos_platform_candidate_bootstrap,lifeos_agent_issuer,lifeos_agent_verifier,lifeos_agent_key_manager',t);
  EXECUTE format('GRANT SELECT,INSERT ON lifeos_platform.%I TO lifeos_platform_candidate_runtime',t);
  EXECUTE format('CREATE POLICY classification_read ON lifeos_platform.%I FOR SELECT TO lifeos_platform_candidate_runtime USING(owner_id=current_setting(''lifeos.owner_id'',true) AND space_id=current_setting(''lifeos.classification_space_id'',true))',t);
  EXECUTE format('CREATE POLICY classification_insert ON lifeos_platform.%I FOR INSERT TO lifeos_platform_candidate_runtime WITH CHECK(owner_id=current_setting(''lifeos.owner_id'',true) AND space_id=current_setting(''lifeos.classification_space_id'',true))',t);
  EXECUTE format('CREATE TRIGGER classification_binding BEFORE INSERT ON lifeos_platform.%I FOR EACH ROW EXECUTE FUNCTION lifeos_platform.classification_insert_binding()',t);
  EXECUTE format('CREATE TRIGGER classification_immutable BEFORE UPDATE OR DELETE ON lifeos_platform.%I FOR EACH ROW EXECUTE FUNCTION lifeos_platform.classification_immutable()',t);
 END LOOP;
 FOREACH signature IN ARRAY ARRAY['classification_keys(jsonb,text[],text[])','classification_canonical(jsonb)','classification_hash(jsonb)','classification_bindings(jsonb)','classification_valid(jsonb,text)','classification_producer_matches(text,text,text)','classification_insert_binding()','classification_immutable()'] LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION lifeos_platform.'||signature||' FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION lifeos_platform.'||signature||' TO lifeos_platform_candidate_runtime';
 END LOOP;
END
$$;
COMMIT;
