-- PROPOSAL ONLY. Does not alter the schema version; does not create a role/account or run automatically.
-- Separately approve the exact empty isolated test DB and this distinct restricted LOGIN role first.
BEGIN;
DO $$ BEGIN
 IF current_database() !~ '^lifeos_platform_test_[a-z0-9_]+$' OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap') THEN
  RAISE EXCEPTION 'Approved isolated grant owner required';
 END IF;
END $$;
GRANT USAGE ON SCHEMA lifeos_platform TO lifeos_platform_candidate_bootstrap;
GRANT SELECT ON lifeos_platform.platform_meta TO lifeos_platform_candidate_bootstrap;
GRANT SELECT,INSERT ON lifeos_platform.platform_user,lifeos_platform.platform_account TO lifeos_platform_candidate_bootstrap;
-- Grant owner must independently verify role flags/no memberships, target CONNECT, no ownership,
-- no schema/database CREATE, and no inherited UPDATE/DELETE/other-table privilege. No cluster-wide revokes here.
COMMIT;
