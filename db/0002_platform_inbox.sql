-- Isolated review migration2. Preserves sources/history and never imports old databases.
BEGIN;
DO $$ BEGIN
 IF current_database() !~ '^lifeos_platform_test_[a-z0-9_]+$' OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap') OR (SELECT version FROM lifeos_platform.platform_meta)<>1 THEN
  RAISE EXCEPTION 'Approved migration owner and schema1 required';
 END IF;
END $$;
ALTER TABLE lifeos_platform.platform_record DROP CONSTRAINT platform_record_kind_check;
ALTER TABLE lifeos_platform.platform_record ADD CONSTRAINT platform_record_kind_check CHECK(kind IN ('todo','finance','inbox'));
DO $$ DECLARE names text[]; BEGIN
 SELECT array_agg(conname) INTO names FROM pg_constraint WHERE conrelid='lifeos_platform.platform_record'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%CASE%';
 IF cardinality(names) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Unexpected record validation constraints'; END IF;
 EXECUTE format('ALTER TABLE lifeos_platform.platform_record DROP CONSTRAINT %I',names[1]);
END $$;
ALTER TABLE lifeos_platform.platform_record ADD CONSTRAINT platform_record_content_check CHECK((CASE
 WHEN kind='todo' THEN jsonb_typeof(draft->'title')='string' AND length(draft->>'title') BETWEEN 1 AND 240 AND draft->>'status' IN ('open','in_progress','done','cancelled') AND original_entry_id IS NULL
 WHEN kind='inbox' THEN jsonb_typeof(draft->'title')='string' AND length(draft->>'title') BETWEEN 1 AND 240 AND jsonb_typeof(draft->'text')='string' AND length(draft->>'text')<=16384 AND draft->>'disposition' IN ('pending','reference','no_action') AND original_entry_id IS NULL
 ELSE draft->>'kind' IN ('expense','income','refund','transfer','repayment') AND draft->>'currency'='CNY' AND jsonb_typeof(draft->'amountMinor')='number' AND (draft->>'amountMinor')::numeric BETWEEN 1 AND 1000000000000 AND (draft->>'amountMinor')::numeric=trunc((draft->>'amountMinor')::numeric)
 AND CASE WHEN draft->>'kind'='refund' THEN original_entry_id IS NOT NULL AND original_entry_id::text=draft->>'originalEntryId' ELSE original_entry_id IS NULL END END) IS TRUE);
ALTER TABLE lifeos_platform.platform_record ADD COLUMN inbox_id uuid;
ALTER TABLE lifeos_platform.platform_record ADD CONSTRAINT record_inbox_owner_fk FOREIGN KEY(owner_id,inbox_id) REFERENCES lifeos_platform.platform_record(owner_id,id);
ALTER TABLE lifeos_platform.platform_record ADD CONSTRAINT record_inbox_kind_check CHECK(inbox_id IS NULL OR (kind='todo' AND inbox_id<>id));
CREATE UNIQUE INDEX platform_one_task_per_inbox ON lifeos_platform.platform_record(owner_id,inbox_id) WHERE inbox_id IS NOT NULL;
ALTER TABLE lifeos_platform.platform_meta DROP CONSTRAINT platform_meta_version_check;
UPDATE lifeos_platform.platform_meta SET version=2;
ALTER TABLE lifeos_platform.platform_meta ADD CONSTRAINT platform_meta_version_check CHECK(version=2);
COMMIT;
