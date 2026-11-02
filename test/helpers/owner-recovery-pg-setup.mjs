// Only the two fresh, isolated GitHub CI services may be initialized here.
const fixturePort=Number(process.env.LIFEOS_FIXTURE_PORT);
if(process.env.CI!=='true'||![55432,55439].includes(fixturePort)||process.env.LIFEOS_FIXTURE_FRESH!=='approved-isolated-fixture')throw Error('Isolated CI fixture required');
import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
const p=new Pool({host:'127.0.0.1',port:fixturePort,user:'postgres',password:'fixture-ci-admin-never-live',database:'lifeos_platform_test_local',max:1});
try {
  const r=(await p.query('SELECT current_database() AS db,current_user AS role,version() AS version')).rows[0];
  if(r.db!=='lifeos_platform_test_local'||r.role!=='postgres'||!r.version.startsWith('PostgreSQL 17.11 '))throw Error('Unexpected target');
  if((await p.query("SELECT to_regnamespace('lifeos_platform') AS schema")).rows[0].schema!==null)throw Error('Fixture is not empty');
  await p.query("CREATE ROLE lifeos_platform_candidate_runtime LOGIN PASSWORD 'fixture-ci-runtime-never-live' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS");
  await p.query("CREATE ROLE lifeos_platform_candidate_bootstrap LOGIN PASSWORD 'fixture-ci-bootstrap-never-live' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS");
  await p.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await p.query('REVOKE CREATE ON DATABASE lifeos_platform_test_local FROM PUBLIC');
  await p.query("SET lifeos.calendar_migration_approved = '1'");
  await p.query("SET lifeos.chat_migration_approved = '1'");
  for(const file of ['0001_platform_candidate.sql','0002_platform_inbox.sql','0003_ai_settings.proposed.sql','0004_calendar.proposed.sql','0005_ai_chat.proposed.sql','platform-synthetic-bootstrap-grants.proposed.sql'])await p.query(readFileSync('db/'+file,'utf8'));
  await p.query("SET lifeos.owner_mfa_migration_approved = 'native-totp-v1'");
  await p.query(readFileSync('db/0009_owner_mfa.proposed.sql','utf8'));
  await p.query('GRANT INSERT(id,identifier,value,"expiresAt","createdAt","updatedAt"), DELETE, UPDATE("expiresAt","updatedAt") ON lifeos_platform.platform_verification TO lifeos_platform_candidate_runtime');
  await p.query('GRANT UPDATE(password,"updatedAt") ON lifeos_platform.platform_account TO lifeos_platform_candidate_runtime');
  await p.query(`CREATE FUNCTION lifeos_platform.fixture_recovery_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF (TG_TABLE_NAME='platform_verification' AND current_setting('lifeos.fixture_fault',true)='consume') OR
       (TG_TABLE_NAME='platform_session' AND current_setting('lifeos.fixture_fault',true)='session') OR
       (TG_TABLE_NAME='platform_account' AND current_setting('lifeos.fixture_fault',true)='password') THEN
      RAISE EXCEPTION 'synthetic failure injection';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
  END $$`);
  await p.query('CREATE TRIGGER fixture_consume BEFORE DELETE ON lifeos_platform.platform_verification FOR EACH ROW EXECUTE FUNCTION lifeos_platform.fixture_recovery_fault()');
  await p.query('CREATE TRIGGER fixture_session BEFORE DELETE ON lifeos_platform.platform_session FOR EACH ROW EXECUTE FUNCTION lifeos_platform.fixture_recovery_fault()');
  await p.query(`CREATE FUNCTION lifeos_platform.fixture_mfa_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF current_setting('lifeos.fixture_fault',true)='mfa-verified' AND NEW.verified IS TRUE AND OLD.verified IS FALSE THEN
      RAISE EXCEPTION 'synthetic final factor verification failure';
    END IF; RETURN NEW;
  END $$`);
  await p.query('CREATE TRIGGER fixture_mfa_verified BEFORE UPDATE ON lifeos_platform.platform_two_factor FOR EACH ROW EXECUTE FUNCTION lifeos_platform.fixture_mfa_fault()');
  await p.query('CREATE TRIGGER fixture_password BEFORE UPDATE ON lifeos_platform.platform_account FOR EACH ROW EXECUTE FUNCTION lifeos_platform.fixture_recovery_fault()');
} finally {await p.end();}
