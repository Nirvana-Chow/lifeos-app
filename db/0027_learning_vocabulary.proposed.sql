-- Proposed exact-target migration. No automatic application, backfill or operation registration.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
DO $$
BEGIN
 IF current_setting('lifeos.learning_migration_approved',true) IS DISTINCT FROM 'learning-vocabulary-v1'
 OR current_setting('lifeos.agent_expected_database',true) IS DISTINCT FROM current_database()
 OR NOT EXISTS(SELECT 1 FROM lifeos_platform.platform_user WHERE id=current_setting('lifeos.agent_expected_owner',true))
 OR COALESCE(current_setting('lifeos.agent_expected_space',true),'') !~ '^[A-Za-z0-9_-]{8,80}$'
 OR current_user IN ('lifeos_platform_candidate_runtime','lifeos_platform_candidate_bootstrap')
 OR (SELECT relowner FROM pg_class WHERE oid='lifeos_platform.platform_record'::regclass)
    IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname=current_user)
 THEN RAISE EXCEPTION 'Explicit exact-target vocabulary migration by the platform owner required'; END IF;
END $$;

CREATE TABLE lifeos_platform.learning_card (
 owner_id text NOT NULL REFERENCES lifeos_platform.platform_user(id),
 space_id text NOT NULL CHECK(space_id ~ '^[A-Za-z0-9_-]{8,80}$'),
 id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision=1),
 front text NOT NULL CHECK(length(front) BETWEEN 1 AND 240),
 back text NOT NULL CHECK(length(back) BETWEEN 1 AND 4000),
 created_at timestamptz NOT NULL,
 PRIMARY KEY(owner_id,space_id,id),
 UNIQUE(owner_id,space_id,id,revision)
);

CREATE TABLE lifeos_platform.learning_review (
 owner_id text NOT NULL,
 space_id text NOT NULL,
 id uuid NOT NULL,
 card_id uuid NOT NULL,
 card_revision integer NOT NULL,
 sequence integer NOT NULL CHECK(sequence>0),
 previous_id uuid,
 previous_sequence integer GENERATED ALWAYS AS (NULLIF(sequence - 1,0)) STORED,
 rating text NOT NULL CHECK(rating IN ('again','recalled')),
 reviewed_at timestamptz NOT NULL,
 schedule_version text NOT NULL CHECK(schedule_version='recall-ladder-v1'),
 PRIMARY KEY(owner_id,space_id,id),
 UNIQUE(owner_id,space_id,card_id,sequence),
 UNIQUE(owner_id,space_id,card_id,sequence,id),
 UNIQUE(owner_id,space_id,card_id,id),
 CHECK((sequence=1)=(previous_id IS NULL)),
 FOREIGN KEY(owner_id,space_id,card_id,card_revision) REFERENCES lifeos_platform.learning_card(owner_id,space_id,id,revision),
 FOREIGN KEY(owner_id,space_id,card_id,previous_sequence,previous_id)
   REFERENCES lifeos_platform.learning_review(owner_id,space_id,card_id,sequence,id)
);

CREATE TABLE lifeos_platform.learning_command (
 owner_id text NOT NULL,
 space_id text NOT NULL,
 command_key text NOT NULL CHECK(command_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$'),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 card_id uuid NOT NULL,
 review_id uuid,
 PRIMARY KEY(owner_id,space_id,command_key),
 FOREIGN KEY(owner_id,space_id,card_id) REFERENCES lifeos_platform.learning_card(owner_id,space_id,id),
 FOREIGN KEY(owner_id,space_id,card_id,review_id) REFERENCES lifeos_platform.learning_review(owner_id,space_id,card_id,id)
);

ALTER TABLE lifeos_platform.learning_card ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.learning_card FORCE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.learning_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.learning_review FORCE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.learning_command ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifeos_platform.learning_command FORCE ROW LEVEL SECURITY;

CREATE POLICY learning_card_scope ON lifeos_platform.learning_card
 USING(owner_id=current_setting('lifeos.owner_id',true) AND space_id=current_setting('lifeos.learning_space_id',true))
 WITH CHECK(owner_id=current_setting('lifeos.owner_id',true) AND space_id=current_setting('lifeos.learning_space_id',true));
CREATE POLICY learning_review_scope ON lifeos_platform.learning_review
 USING(owner_id=current_setting('lifeos.owner_id',true) AND space_id=current_setting('lifeos.learning_space_id',true))
 WITH CHECK(owner_id=current_setting('lifeos.owner_id',true) AND space_id=current_setting('lifeos.learning_space_id',true));
CREATE POLICY learning_command_scope ON lifeos_platform.learning_command
 USING(owner_id=current_setting('lifeos.owner_id',true) AND space_id=current_setting('lifeos.learning_space_id',true))
 WITH CHECK(owner_id=current_setting('lifeos.owner_id',true) AND space_id=current_setting('lifeos.learning_space_id',true));

REVOKE ALL ON lifeos_platform.learning_card,lifeos_platform.learning_review,lifeos_platform.learning_command FROM PUBLIC;
GRANT SELECT,INSERT ON lifeos_platform.learning_card,lifeos_platform.learning_review,lifeos_platform.learning_command TO lifeos_platform_candidate_runtime;
COMMIT;
-- Rollback: close the learning feature and retain the data/receipts for reconciliation.
