import type {SqlPool,SqlClient} from '../platform/postgres.ts';
/** Read-only activation check. No DDL, grants, secret reads or password-only fallback. */
export async function verifyOwnerMfaPool(pool:SqlPool):Promise<void>{
 const client=await pool.connect();
 try{
  await verifyOwnerMfaSchema(client);
  const grants=await client.query(`SELECT
   has_column_privilege(current_user,'lifeos_platform.platform_user','twoFactorEnabled','SELECT') AND
   has_column_privilege(current_user,'lifeos_platform.platform_user','twoFactorEnabled','UPDATE') AND has_column_privilege(current_user,'lifeos_platform.platform_user','updatedAt','UPDATE') AND
   has_column_privilege(current_user,'lifeos_platform.platform_session','mfaVerified','SELECT') AND has_column_privilege(current_user,'lifeos_platform.platform_session','mfaVerified','INSERT') AND
   has_table_privilege(current_user,'lifeos_platform.platform_two_factor','SELECT') AND
   has_column_privilege(current_user,'lifeos_platform.platform_two_factor','id','INSERT') AND has_column_privilege(current_user,'lifeos_platform.platform_two_factor','secret','INSERT') AND
   has_column_privilege(current_user,'lifeos_platform.platform_two_factor','backupCodes','INSERT') AND has_column_privilege(current_user,'lifeos_platform.platform_two_factor','userId','INSERT') AND
   has_column_privilege(current_user,'lifeos_platform.platform_two_factor','verified','INSERT') AND has_column_privilege(current_user,'lifeos_platform.platform_two_factor','failedVerificationCount','INSERT') AND
   has_column_privilege(current_user,'lifeos_platform.platform_two_factor','secret','UPDATE') AND has_column_privilege(current_user,'lifeos_platform.platform_two_factor','backupCodes','UPDATE') AND
   has_column_privilege(current_user,'lifeos_platform.platform_two_factor','verified','UPDATE') AND has_column_privilege(current_user,'lifeos_platform.platform_two_factor','failedVerificationCount','UPDATE') AND has_column_privilege(current_user,'lifeos_platform.platform_two_factor','lockedUntil','UPDATE') AND
   has_table_privilege(current_user,'lifeos_platform.platform_verification','SELECT') AND has_table_privilege(current_user,'lifeos_platform.platform_verification','DELETE') AND
   has_column_privilege(current_user,'lifeos_platform.platform_verification','id','INSERT') AND has_column_privilege(current_user,'lifeos_platform.platform_verification','identifier','INSERT') AND
   has_column_privilege(current_user,'lifeos_platform.platform_verification','value','INSERT') AND has_column_privilege(current_user,'lifeos_platform.platform_verification','expiresAt','INSERT') AND
   has_column_privilege(current_user,'lifeos_platform.platform_verification','createdAt','INSERT') AND has_column_privilege(current_user,'lifeos_platform.platform_verification','updatedAt','INSERT') AS allowed`);
  if(grants.rows.length!==1||grants.rows[0].allowed!==true)throw Error('OWNER_MFA_UNAVAILABLE');
 }finally{client.release();}
}

/** Catalog-only checks shared by runtime and the MAINTAIN-only deployment verifier.
 * Never SELECTs authentication rows; runtime privileges are checked separately. */
export async function verifyOwnerMfaSchema(client:Pick<SqlClient,'query'>):Promise<void>{
  const schema=await client.query(`/* owner-mfa-schema */ SELECT
   (SELECT count(*)=10 FROM (VALUES
    ('platform_user','twoFactorEnabled','bool',false),('platform_session','mfaVerified','bool',true),
    ('platform_two_factor','id','text',true),('platform_two_factor','secret','text',true),('platform_two_factor','backupCodes','text',true),
    ('platform_two_factor','userId','text',true),('platform_two_factor','verified','bool',false),('platform_two_factor','failedVerificationCount','int4',false),('platform_two_factor','lockedUntil','timestamptz',false),('platform_session','userId','text',true)
   ) AS wanted(table_name,column_name,type_name,needs_not_null)
   JOIN pg_namespace n ON n.nspname='lifeos_platform' JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=wanted.table_name
   JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname=wanted.column_name AND NOT a.attisdropped
   JOIN pg_type t ON t.oid=a.atttypid AND t.typname=wanted.type_name AND (NOT wanted.needs_not_null OR a.attnotnull)) AND (SELECT count(*)=7 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lifeos_platform' AND c.relname='platform_two_factor' AND a.attnum>0 AND NOT a.attisdropped) AS columns_ready,
   EXISTS(SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='userId' WHERE n.nspname='lifeos_platform' AND c.relname='platform_two_factor' AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts=1 AND i.indkey[0]=a.attnum) AS unique_owner`);
  if(schema.rows.length!==1||schema.rows[0].columns_ready!==true||schema.rows[0].unique_owner!==true)throw Error('OWNER_MFA_UNAVAILABLE');
}
/** A partially applied MFA migration is neither a legacy nor an MFA schema. */
export async function verifyOwnerLegacyAuthSchema(client:Pick<SqlClient,'query'>):Promise<void>{
 const result=await client.query(`/* owner-legacy-auth-schema */ SELECT NOT EXISTS(
  SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='lifeos_platform' AND NOT a.attisdropped AND ((c.relname='platform_user' AND a.attname='twoFactorEnabled') OR (c.relname='platform_session' AND a.attname='mfaVerified'))
 ) AS legacy_ready`);
 if(result.rows.length!==1||result.rows[0].legacy_ready!==true)throw Error('OWNER_MFA_UNAVAILABLE');
}
