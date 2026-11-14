-- LO-AGENT-001. Proposed source only: no production migration or activation.
-- Official Better Auth/OAuth/MCP/CIMD 1.7.23; one existing owner identity.
-- Activation separately sets enabled, fixed reviewed grant/scopes/owner email after qualification.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
DO $$ BEGIN
 IF current_setting('lifeos.business_mcp_oauth_approved',true) IS DISTINCT FROM '1'
 OR current_setting('lifeos.agent_expected_database',true) IS DISTINCT FROM current_database()
 OR current_setting('lifeos.agent_expected_owner',true) IS DISTINCT FROM (SELECT owner_id FROM lifeos_agent.key_management_binding)
 OR current_setting('lifeos.agent_expected_space',true) IS DISTINCT FROM (SELECT space_id FROM lifeos_agent.key_management_binding)
 OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_agent_verifier','lifeos_agent_key_manager')
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_agent.apikey'::regclass) IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 OR to_regprocedure('lifeos_agent.assert_current_business_grant(text,text,text,text[],text,text)') IS NULL
 OR EXISTS(SELECT 1 FROM pg_roles r WHERE rolname='lifeos_platform_candidate_runtime' AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolbypassrls OR r.rolreplication OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)))
 THEN RAISE EXCEPTION 'Explicit exact-target OAuth approval and owning migration role required'; END IF;
END $$;
-- Generated from official @better-auth/oauth-provider 1.7.23 schema; reviewed PostgreSQL adapter mapping.
CREATE TABLE lifeos_platform.platform_oauth_client(
 id text PRIMARY KEY,
 "clientId" text NOT NULL UNIQUE,
 "clientSecret" text,
 "clientDiscoveryId" text,
 "disabled" boolean DEFAULT false,
 "skipConsent" boolean,
 "enableEndSession" boolean,
 "subjectType" text,
 "scopes" jsonb,
 "clientCredentialsScopes" jsonb DEFAULT '[]'::jsonb,
 "userId" text REFERENCES lifeos_platform.platform_user("id"),
 "createdAt" timestamptz,
 "updatedAt" timestamptz,
 "name" text,
 "uri" text,
 "icon" text,
 "contacts" jsonb,
 "tos" text,
 "policy" text,
 "softwareId" text,
 "softwareVersion" text,
 "softwareStatement" text,
 "redirectUris" jsonb NOT NULL,
 "postLogoutRedirectUris" jsonb,
 "backchannelLogoutUri" text,
 "backchannelLogoutSessionRequired" boolean,
 "tokenEndpointAuthMethod" text,
 "applicationType" text,
 "jwks" text,
 "jwksUri" text,
 "grantTypes" jsonb,
 "responseTypes" jsonb,
 "requirePKCE" boolean,
 "dpopBoundAccessTokens" boolean DEFAULT false,
 "referenceId" text,
 "metadata" jsonb
);
CREATE INDEX ON lifeos_platform.platform_oauth_client("userId");
CREATE TABLE lifeos_platform.platform_oauth_resource(
 id text PRIMARY KEY,
 "identifier" text NOT NULL UNIQUE,
 "name" text NOT NULL,
 "accessTokenTtl" integer,
 "refreshTokenTtl" integer,
 "signingAlgorithm" text,
 "signingKeyId" text,
 "allowedScopes" jsonb,
 "customClaims" jsonb,
 "dpopBoundAccessTokensRequired" boolean DEFAULT false,
 "disabled" boolean DEFAULT false,
 "createdAt" timestamptz,
 "updatedAt" timestamptz,
 "policyVersion" integer DEFAULT 1,
 "metadata" jsonb
);
CREATE TABLE lifeos_platform.platform_oauth_client_resource(
 id text PRIMARY KEY,
 "clientId" text NOT NULL REFERENCES lifeos_platform.platform_oauth_client("clientId") ON DELETE CASCADE,
 "resourceId" text NOT NULL REFERENCES lifeos_platform.platform_oauth_resource("identifier") ON DELETE CASCADE,
 "metadata" jsonb,
 "createdAt" timestamptz
);
CREATE INDEX ON lifeos_platform.platform_oauth_client_resource("clientId");
CREATE INDEX ON lifeos_platform.platform_oauth_client_resource("resourceId");
CREATE UNIQUE INDEX ON lifeos_platform.platform_oauth_client_resource("clientId","resourceId");
CREATE TABLE lifeos_platform.platform_oauth_refresh_token(
 id text PRIMARY KEY,
 "token" text NOT NULL UNIQUE,
 "clientId" text NOT NULL REFERENCES lifeos_platform.platform_oauth_client("clientId"),
 "sessionId" text REFERENCES lifeos_platform.platform_session("id") ON DELETE SET NULL,
 "userId" text NOT NULL REFERENCES lifeos_platform.platform_user("id"),
 "referenceId" text,
 "authorizationCodeId" text,
 "resources" jsonb,
 "requestedUserInfoClaims" jsonb,
 "expiresAt" timestamptz NOT NULL,
 "createdAt" timestamptz NOT NULL,
 "revoked" timestamptz,
 "rotatedAt" timestamptz,
 "rotationReplayResponse" text,
 "rotationReplayExpiresAt" timestamptz,
 "authTime" timestamptz,
 "confirmation" jsonb,
 "scopes" jsonb NOT NULL
);
CREATE INDEX ON lifeos_platform.platform_oauth_refresh_token("clientId");
CREATE INDEX ON lifeos_platform.platform_oauth_refresh_token("sessionId");
CREATE INDEX ON lifeos_platform.platform_oauth_refresh_token("userId");
CREATE INDEX ON lifeos_platform.platform_oauth_refresh_token("authorizationCodeId");
CREATE TABLE lifeos_platform.platform_oauth_access_token(
 id text PRIMARY KEY,
 "token" text NOT NULL UNIQUE,
 "clientId" text NOT NULL REFERENCES lifeos_platform.platform_oauth_client("clientId"),
 "sessionId" text REFERENCES lifeos_platform.platform_session("id") ON DELETE SET NULL,
 "userId" text REFERENCES lifeos_platform.platform_user("id"),
 "referenceId" text,
 "authorizationCodeId" text,
 "resources" jsonb,
 "requestedUserInfoClaims" jsonb,
 "refreshId" text REFERENCES lifeos_platform.platform_oauth_refresh_token("id"),
 "expiresAt" timestamptz NOT NULL,
 "createdAt" timestamptz NOT NULL,
 "revoked" timestamptz,
 "confirmation" jsonb,
 "scopes" jsonb NOT NULL
);
CREATE INDEX ON lifeos_platform.platform_oauth_access_token("clientId");
CREATE INDEX ON lifeos_platform.platform_oauth_access_token("sessionId");
CREATE INDEX ON lifeos_platform.platform_oauth_access_token("userId");
CREATE INDEX ON lifeos_platform.platform_oauth_access_token("authorizationCodeId");
CREATE INDEX ON lifeos_platform.platform_oauth_access_token("refreshId");
CREATE TABLE lifeos_platform.platform_oauth_consent(
 id text PRIMARY KEY,
 "clientId" text NOT NULL REFERENCES lifeos_platform.platform_oauth_client("clientId"),
 "userId" text REFERENCES lifeos_platform.platform_user("id"),
 "referenceId" text,
 "resources" jsonb,
 "requestedUserInfoClaims" jsonb,
 "scopes" jsonb NOT NULL,
 "createdAt" timestamptz NOT NULL,
 "updatedAt" timestamptz NOT NULL
);
CREATE INDEX ON lifeos_platform.platform_oauth_consent("clientId");
CREATE INDEX ON lifeos_platform.platform_oauth_consent("userId");
CREATE TABLE lifeos_platform.platform_oauth_client_assertion(
 id text PRIMARY KEY,
 "expiresAt" timestamptz NOT NULL
);
CREATE TABLE lifeos_platform.platform_oauth_jwks(id text PRIMARY KEY,"publicKey" text NOT NULL,"privateKey" text NOT NULL,"createdAt" timestamptz NOT NULL,"expiresAt" timestamptz,alg text,crv text);

-- New provider objects follow the actual existing identity-table owner.
-- Existing tables, schema owners, role attributes/membership and ACLs are untouched.
DO $$ DECLARE provider_owner name;t text; BEGIN
 SELECT pg_get_userbyid(relowner) INTO provider_owner FROM pg_class
 WHERE oid='lifeos_platform.platform_user'::regclass;
 IF provider_owner IS NULL OR provider_owner IN('lifeos_platform_candidate_runtime','lifeos_agent_verifier','lifeos_agent_key_manager')
 OR NOT pg_has_role(current_user,provider_owner,'SET')
 OR NOT has_schema_privilege(provider_owner,'lifeos_platform','CREATE')
 THEN RAISE EXCEPTION 'Existing identity owner must be a qualified provider object owner';END IF;
 FOREACH t IN ARRAY ARRAY['platform_oauth_client','platform_oauth_resource','platform_oauth_client_resource','platform_oauth_refresh_token','platform_oauth_access_token','platform_oauth_consent','platform_oauth_client_assertion','platform_oauth_jwks'] LOOP
  EXECUTE format('ALTER TABLE lifeos_platform.%I OWNER TO %I',t,provider_owner);
 END LOOP;
END $$;

CREATE TABLE lifeos_agent.oauth_business_control(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),enabled boolean NOT NULL DEFAULT false,
 owner_id text NOT NULL,space_id text NOT NULL,owner_email text,
 grant_id text,scopes text[] NOT NULL DEFAULT '{}',
 issuer text NOT NULL DEFAULT 'https://lifeos.nirvanachow.com/api/platform/auth' CHECK(issuer='https://lifeos.nirvanachow.com/api/platform/auth'),
 resource text NOT NULL DEFAULT 'https://lifeos.nirvanachow.com/api/platform/mcp' CHECK(resource='https://lifeos.nirvanachow.com/api/platform/mcp'),
 CHECK(NOT enabled OR (grant_id IS NOT NULL AND owner_email IS NOT NULL AND cardinality(scopes)>0))
);
INSERT INTO lifeos_agent.oauth_business_control(owner_id,space_id) SELECT owner_id,space_id FROM lifeos_agent.key_management_binding;
CREATE TABLE lifeos_agent.oauth_business_binding(
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 owner_id text NOT NULL,space_id text NOT NULL,grant_id text NOT NULL,client_id text NOT NULL,
 consent_id text NOT NULL,consent_digest text NOT NULL,client_digest text NOT NULL,
 scopes text[] NOT NULL,revision integer NOT NULL DEFAULT 1,enabled boolean NOT NULL DEFAULT false,
 UNIQUE(owner_id,space_id,client_id)
);
CREATE TABLE lifeos_agent.oauth_business_token(
 token_id text PRIMARY KEY CHECK(token_id ~ '^[a-f0-9]{64}$'),binding_id text NOT NULL REFERENCES lifeos_agent.oauth_business_binding(id),
 binding_revision integer NOT NULL,session_id text,scopes text[] NOT NULL,
 issued_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,revoked boolean NOT NULL DEFAULT false,
 CHECK(expires_at>issued_at)
);
REVOKE ALL ON lifeos_agent.oauth_business_control,lifeos_agent.oauth_business_binding,lifeos_agent.oauth_business_token FROM PUBLIC;

-- One global, transaction-scoped OAuth gate precedes *every* OAuth mutation row lock.
-- BEFORE STATEMENT is essential: a row trigger runs after UPDATE has locked its row.
-- Business order: owner maintenance -> command -> OAuth gate -> OAuth rows -> original grant -> records.
-- Provider order: OAuth gate -> provider rows -> invalidation; never command/grant/record writes.
CREATE FUNCTION lifeos_agent.oauth_business_statement_gate() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('lifeos-business-mcp-oauth-v1',0));RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['platform_oauth_client','platform_oauth_resource','platform_oauth_client_resource','platform_oauth_refresh_token','platform_oauth_access_token','platform_oauth_consent','platform_oauth_client_assertion','platform_oauth_jwks','platform_verification','platform_user','platform_account','platform_two_factor'] LOOP
  EXECUTE format('CREATE TRIGGER oauth_business_gate BEFORE INSERT OR UPDATE OR DELETE ON lifeos_platform.%I FOR EACH STATEMENT EXECUTE FUNCTION lifeos_agent.oauth_business_statement_gate()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['oauth_business_control','oauth_business_binding','oauth_business_token'] LOOP
  EXECUTE format('CREATE TRIGGER oauth_business_gate BEFORE INSERT OR UPDATE OR DELETE ON lifeos_agent.%I FOR EACH STATEMENT EXECUTE FUNCTION lifeos_agent.oauth_business_statement_gate()',t);
 END LOOP;
END $$;

-- OAuth delegation survives normal browser expiry/logout, but never an identity/MFA loss.
CREATE FUNCTION lifeos_agent.oauth_business_identity_ready(owner_id text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c lifeos_agent.oauth_business_control%ROWTYPE;u lifeos_platform.platform_user%ROWTYPE;f lifeos_platform.platform_two_factor%ROWTYPE; BEGIN
 SELECT * INTO c FROM lifeos_agent.oauth_business_control WHERE singleton;
 IF NOT c.enabled OR c.owner_id IS DISTINCT FROM owner_id THEN RETURN false;END IF;
 SELECT * INTO u FROM lifeos_platform.platform_user WHERE id=owner_id FOR SHARE;
 IF NOT FOUND OR lower(u.email) IS DISTINCT FROM lower(c.owner_email) OR u."twoFactorEnabled" IS NOT TRUE THEN RETURN false;END IF;
 SELECT * INTO f FROM lifeos_platform.platform_two_factor WHERE "userId"=owner_id FOR SHARE;
 RETURN FOUND AND f.verified IS TRUE;
END $$;

CREATE FUNCTION lifeos_agent.oauth_business_owner_ready(session_id text,owner_id text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c lifeos_agent.oauth_business_control%ROWTYPE;s lifeos_platform.platform_session%ROWTYPE;u lifeos_platform.platform_user%ROWTYPE;f lifeos_platform.platform_two_factor%ROWTYPE; BEGIN
 SELECT * INTO c FROM lifeos_agent.oauth_business_control WHERE singleton;
 IF NOT c.enabled OR c.owner_id IS DISTINCT FROM owner_id THEN RETURN false;END IF;
 SELECT * INTO s FROM lifeos_platform.platform_session WHERE id=session_id FOR SHARE;
 IF NOT FOUND OR s."userId" IS DISTINCT FROM owner_id OR s."expiresAt"<=clock_timestamp() OR s."mfaVerified" IS NOT TRUE THEN RETURN false;END IF;
 SELECT * INTO u FROM lifeos_platform.platform_user WHERE id=owner_id FOR SHARE;
 IF NOT FOUND OR lower(u.email) IS DISTINCT FROM lower(c.owner_email) OR u."twoFactorEnabled" IS NOT TRUE THEN RETURN false;END IF;
 SELECT * INTO f FROM lifeos_platform.platform_two_factor WHERE "userId"=owner_id FOR SHARE;
 RETURN FOUND AND f.verified IS TRUE;
END $$;

-- Native provider code persistence rechecks MFA, including old-consent reuse and continue.
-- All other verification payloads (MFA/password reset/rate limits) keep native behavior.
CREATE FUNCTION lifeos_agent.oauth_business_code_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE v jsonb;c lifeos_agent.oauth_business_control%ROWTYPE; BEGIN
 BEGIN v:=NEW.value::jsonb;EXCEPTION WHEN invalid_text_representation THEN RETURN NEW;END;
 IF v->>'type' IS DISTINCT FROM 'authorization_code' THEN RETURN NEW;END IF;
 SELECT * INTO c FROM lifeos_agent.oauth_business_control WHERE singleton;
 IF NOT c.enabled OR v->>'referenceId' IS DISTINCT FROM 'lifeos-business-mcp-v1'
 OR NOT lifeos_agent.oauth_business_owner_ready(v->>'sessionId',v->>'userId')
 OR v->'resource' IS DISTINCT FROM jsonb_build_array(c.resource)
 OR v->'query'->>'code_challenge_method' IS DISTINCT FROM 'S256'
 OR NOT EXISTS(SELECT 1 FROM lifeos_platform.platform_oauth_client x WHERE x."clientId"=v->'query'->>'client_id' AND x.disabled IS NOT TRUE AND x."skipConsent" IS NOT TRUE AND x."tokenEndpointAuthMethod" IN ('none','private_key_jwt'))
 THEN RAISE EXCEPTION 'Current owner MFA and fixed resource required' USING ERRCODE='LG403';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER oauth_business_code_guard BEFORE INSERT OR UPDATE ON lifeos_platform.platform_verification FOR EACH ROW EXECUTE FUNCTION lifeos_agent.oauth_business_code_guard();

CREATE FUNCTION lifeos_agent.oauth_business_invalidate() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE old_json jsonb:=to_jsonb(OLD);new_json jsonb:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END; BEGIN
 IF TG_TABLE_NAME='platform_oauth_refresh_token' THEN
  IF TG_OP<>'DELETE' AND (NEW.revoked IS NULL OR NEW."rotatedAt" IS NOT NULL) THEN RETURN NEW;END IF;
  UPDATE lifeos_agent.oauth_business_binding SET enabled=false,revision=revision+1 WHERE client_id=OLD."clientId" AND owner_id=OLD."userId";
 ELSIF TG_TABLE_NAME='platform_oauth_consent' THEN
  IF TG_OP='UPDATE' AND old_json=new_json THEN RETURN NEW;END IF;
  UPDATE lifeos_agent.oauth_business_binding SET enabled=false,revision=revision+1 WHERE consent_id=OLD.id;
 ELSIF TG_TABLE_NAME='platform_oauth_client' THEN
  IF TG_OP='UPDATE' AND (old_json-'updatedAt'-'createdAt')=(new_json-'updatedAt'-'createdAt') THEN RETURN NEW;END IF;
  UPDATE lifeos_agent.oauth_business_binding SET enabled=false,revision=revision+1 WHERE client_id=OLD."clientId";
 ELSE
  UPDATE lifeos_agent.oauth_business_binding SET enabled=false,revision=revision+1;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['platform_oauth_client','platform_oauth_consent','platform_oauth_refresh_token','platform_oauth_resource','platform_oauth_client_resource'] LOOP
  EXECUTE format('CREATE TRIGGER oauth_business_invalidate AFTER UPDATE OR DELETE ON lifeos_platform.%I FOR EACH ROW EXECUTE FUNCTION lifeos_agent.oauth_business_invalidate()',t);
 END LOOP;
END $$;

-- A password change/reset and owner identity/MFA loss revoke the durable delegation.
-- Ordinary session deletion has no such trigger and ends only the browser session.
CREATE FUNCTION lifeos_agent.oauth_business_security_invalidate() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE changed boolean:=TG_OP='DELETE';target_owner text; BEGIN
 IF TG_TABLE_NAME='platform_account' THEN
  target_owner:=OLD."userId";changed:=changed OR OLD.password IS DISTINCT FROM NEW.password;
 ELSIF TG_TABLE_NAME='platform_user' THEN
  target_owner:=OLD.id;changed:=changed OR OLD.email IS DISTINCT FROM NEW.email OR OLD."twoFactorEnabled" IS DISTINCT FROM NEW."twoFactorEnabled";
 ELSE
  target_owner:=OLD."userId";changed:=changed OR OLD.secret IS DISTINCT FROM NEW.secret OR OLD.verified IS DISTINCT FROM NEW.verified;
 END IF;
 IF changed THEN UPDATE lifeos_agent.oauth_business_binding b SET enabled=false,revision=revision+1 WHERE b.owner_id=target_owner;END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['platform_user','platform_account','platform_two_factor'] LOOP
  EXECUTE format('CREATE TRIGGER oauth_business_security_invalidate AFTER UPDATE OR DELETE ON lifeos_platform.%I FOR EACH ROW EXECUTE FUNCTION lifeos_agent.oauth_business_security_invalidate()',t);
 END LOOP;
END $$;

CREATE FUNCTION lifeos_agent.approve_oauth_business_binding(session_id text,grant_id text,owner_id text,space_id text,client_id text,approved_scopes text[])
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c lifeos_agent.oauth_business_control%ROWTYPE;x lifeos_platform.platform_oauth_client%ROWTYPE;a lifeos_platform.platform_oauth_consent%ROWTYPE;k lifeos_agent.apikey%ROWTYPE; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('lifeos-business-mcp-oauth-v1',0));
 SELECT * INTO c FROM lifeos_agent.oauth_business_control WHERE singleton;
 IF NOT c.enabled OR (grant_id,owner_id,space_id) IS DISTINCT FROM (c.grant_id,c.owner_id,c.space_id)
 OR NOT lifeos_agent.oauth_business_owner_ready(session_id,owner_id) OR cardinality(approved_scopes)=0 OR NOT approved_scopes<@c.scopes THEN RETURN false;END IF;
 SELECT * INTO x FROM lifeos_platform.platform_oauth_client WHERE "clientId"=client_id FOR SHARE;
 IF NOT FOUND OR x.disabled IS TRUE OR x."skipConsent" IS TRUE OR COALESCE(x."tokenEndpointAuthMethod",'') NOT IN ('none','private_key_jwt') THEN RETURN false;END IF;
 SELECT * INTO a FROM lifeos_platform.platform_oauth_consent WHERE "clientId"=client_id AND "userId"=owner_id AND "referenceId"='lifeos-business-mcp-v1' FOR SHARE;
 IF NOT FOUND OR a.resources IS DISTINCT FROM jsonb_build_array(c.resource) OR a.scopes IS DISTINCT FROM to_jsonb(approved_scopes) THEN RETURN false;END IF;
 SELECT * INTO k FROM lifeos_agent.apikey WHERE id=grant_id FOR SHARE;
 IF NOT FOUND OR k.enabled IS NOT TRUE OR k."referenceId" IS DISTINCT FROM owner_id OR k.metadata::jsonb->>'spaceId' IS DISTINCT FROM space_id OR k."expiresAt" IS NULL OR k."expiresAt"<=clock_timestamp() THEN RETURN false;END IF;
 INSERT INTO lifeos_agent.oauth_business_binding(owner_id,space_id,grant_id,client_id,consent_id,consent_digest,client_digest,scopes,enabled)
 VALUES(owner_id,space_id,grant_id,client_id,a.id,encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex'),encode(sha256(convert_to((to_jsonb(x)-'updatedAt'-'createdAt')::text,'UTF8')),'hex'),approved_scopes,true)
 ON CONFLICT ON CONSTRAINT oauth_business_binding_owner_id_space_id_client_id_key DO UPDATE SET grant_id=EXCLUDED.grant_id,consent_id=EXCLUDED.consent_id,consent_digest=EXCLUDED.consent_digest,client_digest=EXCLUDED.client_digest,scopes=EXCLUDED.scopes,enabled=true,revision=lifeos_agent.oauth_business_binding.revision+1;
 RETURN true;
END $$;

CREATE FUNCTION lifeos_agent.read_oauth_business_token(token_id text,owner_id text,space_id text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c lifeos_agent.oauth_business_control%ROWTYPE;t lifeos_agent.oauth_business_token%ROWTYPE;b lifeos_agent.oauth_business_binding%ROWTYPE;x lifeos_platform.platform_oauth_client%ROWTYPE;a lifeos_platform.platform_oauth_consent%ROWTYPE; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('lifeos-business-mcp-oauth-v1',0));
 SELECT * INTO c FROM lifeos_agent.oauth_business_control WHERE singleton;
 IF NOT c.enabled OR (owner_id,space_id) IS DISTINCT FROM (c.owner_id,c.space_id) THEN RETURN NULL;END IF;
 SELECT * INTO t FROM lifeos_agent.oauth_business_token z WHERE z.token_id=read_oauth_business_token.token_id;
 IF NOT FOUND OR t.revoked OR t.expires_at<=clock_timestamp() THEN RETURN NULL;END IF;
 SELECT * INTO b FROM lifeos_agent.oauth_business_binding WHERE id=t.binding_id;
 IF NOT FOUND OR NOT b.enabled OR b.revision<>t.binding_revision OR (b.owner_id,b.space_id,b.grant_id) IS DISTINCT FROM (c.owner_id,c.space_id,c.grant_id) THEN RETURN NULL;END IF;
 SELECT * INTO x FROM lifeos_platform.platform_oauth_client WHERE "clientId"=b.client_id FOR SHARE;
 IF NOT FOUND OR x.disabled IS TRUE OR x."skipConsent" IS TRUE OR COALESCE(x."tokenEndpointAuthMethod",'') NOT IN ('none','private_key_jwt') OR encode(sha256(convert_to((to_jsonb(x)-'updatedAt'-'createdAt')::text,'UTF8')),'hex')<>b.client_digest THEN RETURN NULL;END IF;
 SELECT * INTO a FROM lifeos_platform.platform_oauth_consent WHERE id=b.consent_id FOR SHARE;
 IF NOT FOUND OR encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex')<>b.consent_digest OR NOT t.scopes<@b.scopes OR NOT t.scopes<@c.scopes THEN RETURN NULL;END IF;
 IF NOT lifeos_agent.oauth_business_identity_ready(owner_id) THEN RETURN NULL;END IF;
 PERFORM 1 FROM lifeos_agent.oauth_business_binding WHERE id=b.id FOR SHARE;
 PERFORM 1 FROM lifeos_agent.oauth_business_token z WHERE z.token_id=t.token_id FOR SHARE;
 RETURN jsonb_build_object('grantId',b.grant_id,'ownerId',b.owner_id,'spaceId',b.space_id,'scopes',t.scopes,'oauthFence',jsonb_build_object('tokenId',t.token_id,'bindingId',b.id,'bindingRevision',b.revision,'expiresAt',extract(epoch FROM t.expires_at)::bigint));
END $$;

CREATE FUNCTION lifeos_agent.register_oauth_business_token(grant_id text,owner_id text,space_id text,token_id text,claims jsonb,grant_type text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c lifeos_agent.oauth_business_control%ROWTYPE;b lifeos_agent.oauth_business_binding%ROWTYPE;k lifeos_agent.apikey%ROWTYPE;ss text[];result jsonb; BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('lifeos-business-mcp-oauth-v1',0));
 SELECT * INTO c FROM lifeos_agent.oauth_business_control WHERE singleton;
 IF NOT c.enabled OR (grant_id,owner_id,space_id) IS DISTINCT FROM (c.grant_id,c.owner_id,c.space_id) OR token_id !~ '^[a-f0-9]{64}$'
 OR claims->>'iss' IS DISTINCT FROM c.issuer OR claims->>'aud' IS DISTINCT FROM c.resource OR claims->>'sub' IS DISTINCT FROM owner_id OR claims->>'azp' IS DISTINCT FROM claims->>'client_id'
 OR grant_type IS NULL OR grant_type NOT IN ('authorization_code','refresh_token') OR NOT lifeos_agent.oauth_business_identity_ready(owner_id)
 OR grant_type='authorization_code' AND NOT lifeos_agent.oauth_business_owner_ready(claims->>'sid',owner_id) THEN RETURN NULL;END IF;
 ss:=string_to_array(claims->>'scope',' ');
 IF cardinality(ss)=0 OR NOT ss<@c.scopes OR to_timestamp((claims->>'exp')::bigint)<=clock_timestamp() OR (claims->>'iat')::bigint>extract(epoch FROM clock_timestamp())+30 OR (claims->>'exp')::bigint-(claims->>'iat')::bigint>3600 THEN RETURN NULL;END IF;
 SELECT * INTO b FROM lifeos_agent.oauth_business_binding z WHERE z.owner_id=register_oauth_business_token.owner_id AND z.space_id=register_oauth_business_token.space_id AND z.client_id=claims->>'azp';
 IF NOT FOUND OR NOT b.enabled OR NOT ss<@b.scopes THEN RETURN NULL;END IF;
 -- Acquire original grant after the OAuth gate; do not touch business records here.
 SELECT * INTO k FROM lifeos_agent.apikey WHERE id=grant_id FOR SHARE;
 IF NOT FOUND OR k.enabled IS NOT TRUE OR k."referenceId" IS DISTINCT FROM owner_id OR k.metadata::jsonb->>'spaceId' IS DISTINCT FROM space_id OR k."expiresAt" IS NULL OR k."expiresAt"<=clock_timestamp() THEN RETURN NULL;END IF;
 INSERT INTO lifeos_agent.oauth_business_token(token_id,binding_id,binding_revision,session_id,scopes,issued_at,expires_at)
 VALUES(token_id,b.id,b.revision,claims->>'sid',ss,to_timestamp((claims->>'iat')::bigint),to_timestamp((claims->>'exp')::bigint)) ON CONFLICT DO NOTHING;
 result:=lifeos_agent.read_oauth_business_token(token_id,owner_id,space_id);
 IF result IS NULL THEN RAISE EXCEPTION 'Current OAuth authorization unavailable' USING ERRCODE='LG403';END IF;
 RETURN result;
END $$;

CREATE FUNCTION lifeos_agent.assert_oauth_business_grant(grant_id text,owner_id text,space_id text,fence jsonb,required_scopes text[],operation_id text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE current_state jsonb; BEGIN
 current_state:=lifeos_agent.read_oauth_business_token(fence->>'tokenId',owner_id,space_id);
 IF current_state IS NULL OR current_state->>'grantId' IS DISTINCT FROM grant_id OR current_state->'oauthFence' IS DISTINCT FROM fence
 OR operation_id IS NULL OR NOT EXISTS(SELECT 1 FROM lifeos_agent.oauth_business_operation o WHERE o.operation_id=assert_oauth_business_grant.operation_id AND o.required_scopes<@assert_oauth_business_grant.required_scopes)
 OR NOT (to_jsonb(required_scopes)<@(current_state->'scopes')) THEN RETURN false;END IF;
 RETURN true;
END $$;
CREATE TABLE lifeos_agent.oauth_business_operation(operation_id text PRIMARY KEY,required_scopes text[] NOT NULL);
REVOKE ALL ON lifeos_agent.oauth_business_operation FROM PUBLIC;
INSERT INTO lifeos_agent.oauth_business_operation VALUES
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
 ('updatePortfolio',ARRAY['portfolio:read','portfolio:write']),
 ('snapshotCooking',ARRAY['cooking:read']),
 ('getCooking',ARRAY['cooking:read']),
 ('createCooking',ARRAY['cooking:read','cooking:write']),
 ('updateCooking',ARRAY['cooking:read','cooking:write']),
 ('snapshotFeedback',ARRAY['feedback:read']),
 ('getFeedback',ARRAY['feedback:read']),
 ('createFeedback',ARRAY['feedback:read','feedback:write']),
 ('snapshotStorageReviews',ARRAY['storage-review:read']),
 ('getStorageReview',ARRAY['storage-review:read']),
 ('createStorageReview',ARRAY['storage-review:read','storage-review:write']),
 ('updateStorageReviewChecklist',ARRAY['storage-review:read','storage-review:write']),
 ('updateStorageReviewDecision',ARRAY['storage-review:read','storage-review:write']),
 ('snapshotRequirements',ARRAY['requirements:read']),
 ('getRequirement',ARRAY['requirements:read']),
 ('createRequirement',ARRAY['requirements:read','requirements:write']),
 ('updateRequirement',ARRAY['requirements:read','requirements:write']),
 ('listTodos',ARRAY['todo:read']),
 ('snapshotTodos',ARRAY['todo:read']),
 ('getTodo',ARRAY['todo:read']),
 ('createTodo',ARRAY['todo:write']),
 ('updateTodo',ARRAY['todo:write']),
 ('snapshotOrganization',ARRAY['organization:read']),
 ('getOrganization',ARRAY['organization:read']),
 ('createOrganization',ARRAY['organization:read','organization:write']),
 ('updateOrganization',ARRAY['organization:read','organization:write']);

CREATE FUNCTION lifeos_agent.revoke_oauth_business_token(token_id text,owner_id text,client_id text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('lifeos-business-mcp-oauth-v1',0));
 UPDATE lifeos_agent.oauth_business_token t SET revoked=true FROM lifeos_agent.oauth_business_binding b
 WHERE t.token_id=revoke_oauth_business_token.token_id AND t.binding_id=b.id AND b.owner_id=revoke_oauth_business_token.owner_id AND b.client_id=revoke_oauth_business_token.client_id;
 RETURN true; -- RFC7009 unknown/already-revoked tokens do not disclose existence.
END $$;

CREATE FUNCTION lifeos_agent.oauth_business_activation() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('enabled',c.enabled,'ownerId',c.owner_id,'ownerEmail',c.owner_email,'spaceId',c.space_id,'grantId',c.grant_id,'issuer',c.issuer,'resource',c.resource,'scopes',c.scopes,'operations',(SELECT jsonb_object_agg(operation_id,to_jsonb(required_scopes)) FROM lifeos_agent.oauth_business_operation)) FROM lifeos_agent.oauth_business_control c WHERE singleton
$$;

CREATE FUNCTION lifeos_agent.oauth_business_version() RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT 'business-mcp-oauth-v1'::text $$;
DO $$ DECLARE t text;f record; BEGIN
 FOREACH t IN ARRAY ARRAY['platform_oauth_client','platform_oauth_resource','platform_oauth_client_resource','platform_oauth_refresh_token','platform_oauth_access_token','platform_oauth_consent','platform_oauth_client_assertion','platform_oauth_jwks'] LOOP
  EXECUTE format('REVOKE ALL ON lifeos_platform.%I FROM PUBLIC',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON lifeos_platform.%I TO lifeos_platform_candidate_runtime',t);
 END LOOP;
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='lifeos_agent' AND (p.proname LIKE '%oauth_business%' OR p.proname='oauth_business_version') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION lifeos_agent.approve_oauth_business_binding(text,text,text,text,text,text[]),lifeos_agent.register_oauth_business_token(text,text,text,text,jsonb,text),lifeos_agent.read_oauth_business_token(text,text,text),lifeos_agent.assert_oauth_business_grant(text,text,text,jsonb,text[],text),lifeos_agent.revoke_oauth_business_token(text,text,text),lifeos_agent.oauth_business_version(),lifeos_agent.oauth_business_activation() TO lifeos_platform_candidate_runtime;
COMMIT;
-- Rollback: first disable OAuth app flag and control.enabled under the gate; old API keys remain unchanged.
-- Retain the closed OAuth tables/ledger for audit and unknown-result recovery. Revert source+lock to the
-- prior reviewed SHA only after OAuth endpoints are unavailable. No DROP, token export or key replacement.
