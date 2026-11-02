-- PROPOSED ONLY. Never applied by build/start/routes. No live migration authority.
-- A separately approved migration owner, backup and activation recipe are required.
-- Isolated synthetic CI applies this explicitly. Existing core meta remains v2.
-- After activation rollback must retain MFA enforcement or stop personal access;
-- never run a password-only reader, drop the factor, or reset the enabled flag.
BEGIN;
DO $$ BEGIN
 IF current_setting('lifeos.owner_mfa_migration_approved',true) IS DISTINCT FROM 'native-totp-v1'
  OR current_database()<>'lifeos_platform_test_local'
  OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap')
  OR (SELECT version FROM lifeos_platform.platform_meta) IS DISTINCT FROM 2
  OR NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lifeos_platform' AND c.relname='platform_user' AND pg_has_role(current_user,c.relowner,'USAGE')) THEN
  RAISE EXCEPTION 'Explicit native MFA approval, exact isolated database, existing migration owner and core v2 required';
 END IF;
END $$;
ALTER TABLE lifeos_platform.platform_user ADD COLUMN "twoFactorEnabled" boolean DEFAULT false;
ALTER TABLE lifeos_platform.platform_session ADD COLUMN "mfaVerified" boolean NOT NULL DEFAULT false;
CREATE TABLE lifeos_platform.platform_two_factor(
 id text PRIMARY KEY,secret text NOT NULL,"backupCodes" text NOT NULL,
 "userId" text NOT NULL REFERENCES lifeos_platform.platform_user(id),
 verified boolean DEFAULT true,"failedVerificationCount" integer DEFAULT 0,"lockedUntil" timestamptz
);
CREATE INDEX platform_two_factor_secret_idx ON lifeos_platform.platform_two_factor(secret);
-- Stronger than native schema: one factor per owner, including concurrent enable.
CREATE UNIQUE INDEX platform_two_factor_owner_unique ON lifeos_platform.platform_two_factor("userId");
REVOKE ALL ON lifeos_platform.platform_two_factor FROM PUBLIC;
GRANT UPDATE("twoFactorEnabled","updatedAt") ON lifeos_platform.platform_user TO lifeos_platform_candidate_runtime;
GRANT SELECT ON lifeos_platform.platform_two_factor TO lifeos_platform_candidate_runtime;
-- Native adapter injects failedVerificationCount=0 on create, so it needs INSERT.
GRANT INSERT(id,secret,"backupCodes","userId",verified,"failedVerificationCount"),UPDATE(secret,"backupCodes",verified,"failedVerificationCount","lockedUntil") ON lifeos_platform.platform_two_factor TO lifeos_platform_candidate_runtime;
-- Native sign-in challenge creation and atomic consumption. No factor DELETE.
GRANT INSERT(id,identifier,value,"expiresAt","createdAt","updatedAt"),DELETE ON lifeos_platform.platform_verification TO lifeos_platform_candidate_runtime;
COMMIT;
