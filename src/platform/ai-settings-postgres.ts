import{z}from'zod';import type{SqlPool,SqlClient}from'./postgres.ts';import{PlatformError}from'./domain.ts';
import{publicAIConfigSchema}from'./ai-settings-contract.ts';import type{AISettingsRepository,AISettingsRow}from'./ai-settings-repository.ts';
const stored=z.strictObject({ownerId:z.string(),revision:z.number().int().min(1).max(2147483646),materialRevision:z.number().int().min(1).max(2147483646),config:publicAIConfigSchema,secret:z.strictObject({version:z.literal(1),keyId:z.string(),iv:z.string(),tag:z.string(),ciphertext:z.string()}).nullable(),enabled:z.boolean(),testState:z.enum(['never','pending','passed','failed']),testedMaterialRevision:z.number().int().positive().nullable(),testMode:z.enum(['synthetic-sdk-test','approved-live']).nullable(),testStartedAt:z.iso.datetime().nullable(),testedAt:z.iso.datetime().nullable(),updatedAt:z.iso.datetime()});
const select='SELECT owner_id,revision,payload FROM lifeos_platform.platform_ai_settings WHERE owner_id=$1';
function decode(owner:string,value:Record<string,unknown>):AISettingsRow{const row=stored.parse(value.payload);if(row.ownerId!==owner||value.owner_id!==owner||value.revision!==row.revision)throw Error('Invalid scoped AI settings');return row;}
export async function verifyAISettingsPool(pool:SqlPool){const c=await pool.connect();try{const result=await c.query(`SELECT
 (SELECT version FROM lifeos_platform.platform_ai_meta) AS extension_version,
 (SELECT version FROM lifeos_platform.platform_meta) AS core_version,c.relrowsecurity AS rls,c.relforcerowsecurity AS forced,c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned,
 has_table_privilege(current_user,c.oid,'SELECT') AND has_table_privilege(current_user,c.oid,'INSERT') AND has_table_privilege(current_user,c.oid,'UPDATE') AND has_table_privilege(current_user,'lifeos_platform.platform_ai_meta','SELECT') AS required,
 has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege(current_user,'lifeos_platform.platform_ai_meta','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS excessive
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lifeos_platform' AND c.relname='platform_ai_settings'`);const m=result.rows[0];if(result.rows.length!==1||m.extension_version!==1||m.core_version!==2||m.rls!==true||m.forced!==true||m.owned!==false||m.required!==true||m.excessive!==false)throw Error('Approved restricted AI settings extension required');}finally{c.release();}}
export class PostgresAISettingsRepository implements AISettingsRepository{
 private pool:SqlPool;constructor(pool:SqlPool){this.pool=pool;}
 private async scoped<T>(owner:string,action:(c:SqlClient)=>Promise<T>){const c=await this.pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('lifeos.owner_id',$1,true)",[owner]);const value=await action(c);await c.query('COMMIT');return value;}catch(e){await c.query('ROLLBACK').catch(()=>undefined);throw e;}finally{c.release();}}
 async get(owner:string){return this.scoped(owner,async c=>{const r=await c.query(select,[owner]);return r.rows[0]?decode(owner,r.rows[0]):null;});}
 async change(owner:string,expectedRevision:number,update:(previous:AISettingsRow|null)=>AISettingsRow){return this.scoped(owner,async c=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['ai.settings:'+owner]);const result=await c.query(select+' FOR UPDATE',[owner]),previous=result.rows[0]?decode(owner,result.rows[0]):null;
  if((previous?.revision??0)!==expectedRevision)throw new PlatformError(409,'AI_SETTINGS_CONFLICT','配置已更新，请重新读取。');
  const next=stored.parse(update(previous));if(next.ownerId!==owner||next.revision!==expectedRevision+1)throw Error('Invalid scoped AI settings write');
  const written=await c.query('INSERT INTO lifeos_platform.platform_ai_settings AS existing(owner_id,revision,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(owner_id) DO UPDATE SET revision=EXCLUDED.revision,payload=EXCLUDED.payload WHERE existing.revision=$4',[owner,next.revision,JSON.stringify(next),expectedRevision]);if(written.rowCount!==1)throw new PlatformError(409,'AI_SETTINGS_CONFLICT','配置已更新，请重新读取。');return next;
 });}
}
