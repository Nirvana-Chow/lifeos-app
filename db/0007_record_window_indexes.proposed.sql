-- PROPOSED ONLY: no build/start/API/test applies these indexes.
-- Existing SQL LIMIT bounds returned rows, not database work. Real EXPLAIN needed.
BEGIN;
DO $$ BEGIN
 IF current_setting('lifeos.window_index_migration_approved',true) IS DISTINCT FROM '1'
 OR current_database() !~ '^lifeos_platform_test_[a-z0-9_]+$'
 OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap')
 OR (SELECT version FROM lifeos_platform.platform_meta)<>2 THEN
  RAISE EXCEPTION 'Specific approved isolated migration operator required';
 END IF;
END $$;
CREATE INDEX platform_record_owner_created_id_window_idx
 ON lifeos_platform.platform_record(owner_id,created_at DESC,id DESC);
CREATE INDEX platform_history_owner_created_id_revision_window_idx
 ON lifeos_platform.platform_history(owner_id,created_at DESC,record_id DESC,revision DESC);
COMMIT;
