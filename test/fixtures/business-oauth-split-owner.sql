-- Synthetic only, after the exact fresh requirements fixture gate. Never a production migration.
-- Mirrors the catalogued split owners and their attributes; no production rows or credentials.
BEGIN;
CREATE ROLE lifeos_auth_test_bootstrap LOGIN SUPERUSER CREATEDB CREATEROLE INHERIT BYPASSRLS REPLICATION;
CREATE ROLE lifeos_platform_candidate_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;
ALTER SCHEMA lifeos_agent OWNER TO lifeos_auth_test_bootstrap;
ALTER SCHEMA lifeos_platform OWNER TO lifeos_platform_candidate_migrator;
DO $$ DECLARE r record; target_owner name; BEGIN
 FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN('lifeos_agent','lifeos_platform') AND c.relkind='r' LOOP
  target_owner:=CASE WHEN r.nspname='lifeos_agent' OR r.relname='platform_two_factor'
   THEN 'lifeos_auth_test_bootstrap' ELSE 'lifeos_platform_candidate_migrator' END;
  EXECUTE format('ALTER TABLE %I.%I OWNER TO %I',r.nspname,r.relname,target_owner);
 END LOOP;
 FOR r IN SELECT p.oid::regprocedure signature,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN('lifeos_agent','lifeos_platform') LOOP
  target_owner:=CASE WHEN r.nspname='lifeos_agent' THEN 'lifeos_auth_test_bootstrap' ELSE 'lifeos_platform_candidate_migrator' END;
  EXECUTE format('ALTER FUNCTION %s OWNER TO %I',r.signature,target_owner);
 END LOOP;
END $$;
-- The catalogued password-reset grant is absent from the older requirements baseline.
SET LOCAL ROLE lifeos_platform_candidate_migrator;
GRANT UPDATE(password,"updatedAt") ON lifeos_platform.platform_account TO lifeos_platform_candidate_runtime;
COMMIT;
