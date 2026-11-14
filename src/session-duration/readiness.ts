import type {SqlPool} from '../platform/postgres.ts';
import {sessionFreshnessPins} from './freshness-pins.ts';
/** Catalog and ACL checks only; no migration or authentication-row reads. */
export async function verifySessionDurationPool(pool:SqlPool):Promise<void>{
 const client=await pool.connect();try{
  const result=await client.query(`SELECT
   (SELECT count(*)=2 FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid WHERE a.attrelid='lifeos_platform.platform_session'::regclass AND NOT a.attisdropped AND a.attnotnull AND ((a.attname='sessionDurationMode' AND t.typname='text') OR (a.attname='sessionDurationSeconds' AND t.typname='int4'))) AS columns_ready,
   EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='lifeos_platform.platform_session'::regclass AND conname='platform_session_duration_policy' AND convalidated) AS policy_ready,
   EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='lifeos_platform.platform_session'::regclass AND tgname='platform_session_duration_guard' AND tgfoid=to_regprocedure('lifeos_platform.guard_session_duration()') AND tgenabled='O' AND NOT tgisinternal) AS guard_ready,
   has_table_privilege(current_user,'lifeos_platform.platform_session','SELECT') AND has_table_privilege(current_user,'lifeos_platform.platform_session','INSERT') AND has_table_privilege(current_user,'lifeos_platform.platform_session','UPDATE') AND has_table_privilege(current_user,'lifeos_platform.platform_session','DELETE') AND NOT has_table_privilege(current_user,'lifeos_platform.platform_session','TRUNCATE,TRIGGER') AS grants_ready`);
  const constraint=await client.query("SELECT pg_get_constraintdef(oid,true) AS definition FROM pg_constraint WHERE conrelid='lifeos_platform.platform_session'::regclass AND conname='platform_session_duration_policy'");
  if(constraint.rows.length!==1||String(constraint.rows[0].definition).replace(/lifeos_platform\./g,'')!=='CHECK (valid_session_duration(\"sessionDurationMode\", \"sessionDurationSeconds\"))')throw Error('DEVICE_SESSION_CONSTRAINT_UNAVAILABLE');
  if((await client.query("SELECT md5(prosrc) AS hash FROM pg_proc WHERE oid=to_regprocedure($1)",['lifeos_platform.valid_session_duration(text,integer)'])).rows[0]?.hash!=='45f715fea36e75d097642084a33eba5a')throw Error('DEVICE_SESSION_GUARD_UNAVAILABLE');
  if((await client.query("SELECT md5(prosrc) AS hash FROM pg_proc WHERE oid=to_regprocedure($1)",['lifeos_platform.guard_session_duration()'])).rows[0]?.hash!=='310f1f0f3138aae7dfbf87caabae8a3d')throw Error('DEVICE_SESSION_GUARD_UNAVAILABLE');
  const row=result.rows[0];if(result.rows.length!==1||!row||Object.values(row).some(v=>v!==true))throw Error('DEVICE_SESSION_SCHEMA_UNAVAILABLE');
  for(const pin of sessionFreshnessPins){
   const checked=await client.query('SELECT md5(prosrc) AS hash,prosecdef AS secured FROM pg_proc WHERE oid=to_regprocedure($1)',[pin.signature]);
   if(checked.rows.length&&(!checked.rows[0].secured||!([pin.bodyMd5,...('delegatingBodyMd5'in pin?[pin.delegatingBodyMd5]:[])] as string[]).includes(String(checked.rows[0].hash))))throw Error('DEVICE_SESSION_FRESHNESS_UNAVAILABLE');
  }
 }finally{client.release();}
}
