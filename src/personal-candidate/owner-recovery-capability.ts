import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {basename,dirname,resolve} from 'node:path';
import {readReviewConfig} from '../platform/private-config.ts';
import {readPlatformConfig} from '../platform/config.ts';
import {candidateBuildDirectory} from '../platform/build-directory.ts';
import {readPersonalConfig,type PersonalConfig} from './config.ts';
import {readOwnerAccountAccess} from './account-access.ts';

const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** The digest is a protected host attestation, not a measurement made inside the container. */
export function checkRecoveryApproval(raw:unknown,personal:Pick<PersonalConfig,'ownerId'|'spaceId'|'baseURL'>,proof:unknown,buildId:string,now=new Date()):boolean{
 try{
  if(!object(raw)||Object.keys(raw).sort().join(',')!=='attestation,buildId,expiresAt,imageDigest,issuedAt,origin,ownerId,sourceSha,sourceTreeDigest,spaceId,version'||!object(proof)||proof.version!==1||!Array.isArray(proof.files)||proof.files.length>2000)return false;
  const start=Date.parse(String(raw.issuedAt)),end=Date.parse(String(raw.expiresAt)),time=now.valueOf();
  const digest=createHash('sha256').update(JSON.stringify(proof.files)).digest('hex');
  return raw.version===1&&raw.attestation==='owner-host-recovery-v1'&&raw.ownerId===personal.ownerId&&raw.spaceId===personal.spaceId&&raw.origin===personal.baseURL&&new URL(personal.baseURL).protocol==='https:'&&typeof raw.sourceSha==='string'&&/^[a-f0-9]{40}$/.test(raw.sourceSha)&&proof.sourceSha===raw.sourceSha&&raw.sourceTreeDigest===digest&&proof.sourceTreeDigest===digest&&raw.buildId===buildId&&/^[A-Za-z0-9_-]{1,100}$/.test(buildId)&&typeof raw.imageDigest==='string'&&/^sha256:[a-f0-9]{64}$/.test(raw.imageDigest)&&Number.isFinite(time)&&Number.isFinite(start)&&Number.isFinite(end)&&typeof raw.issuedAt==='string'&&typeof raw.expiresAt==='string'&&new Date(start).toISOString()===raw.issuedAt&&new Date(end).toISOString()===raw.expiresAt&&start<=time&&time<end&&end>start&&end-start<=900000;
 }catch{return false;}
}
type QueryPool={query:(sql:string)=>Promise<{rows:unknown[]}>};
export async function verifyRecoveryPermissions(pool:QueryPool):Promise<boolean>{
 try{const result=await pool.query(`SELECT has_table_privilege(current_user,'lifeos_platform.platform_verification','SELECT') AS verification_read,
 (SELECT bool_and(has_column_privilege(current_user,'lifeos_platform.platform_verification',col,'INSERT')) FROM unnest(ARRAY['id','identifier','value','expiresAt','createdAt','updatedAt']) AS col) AS verification_insert,
 has_table_privilege(current_user,'lifeos_platform.platform_verification','DELETE') AS verification_delete,
 has_column_privilege(current_user,'lifeos_platform.platform_verification','expiresAt','UPDATE') AND has_column_privilege(current_user,'lifeos_platform.platform_verification','updatedAt','UPDATE') AS verification_update,
 has_table_privilege(current_user,'lifeos_platform.platform_account','SELECT') AS account_read,
 has_column_privilege(current_user,'lifeos_platform.platform_account','password','UPDATE') AND has_column_privilege(current_user,'lifeos_platform.platform_account','updatedAt','UPDATE') AS account_update,
 has_table_privilege(current_user,'lifeos_platform.platform_user','SELECT') AS user_read,
 has_table_privilege(current_user,'lifeos_platform.platform_session','SELECT') AND has_table_privilege(current_user,'lifeos_platform.platform_session','DELETE') AS session_access,
 has_table_privilege(current_user,'lifeos_platform.platform_rate_limit','SELECT') AND has_table_privilege(current_user,'lifeos_platform.platform_rate_limit','INSERT') AND has_table_privilege(current_user,'lifeos_platform.platform_rate_limit','UPDATE') AS limit_access`);
  if(result.rows.length!==1||!object(result.rows[0]))return false;const r=result.rows[0];return ['verification_read','verification_insert','verification_delete','verification_update','account_read','account_update','user_read','session_access','limit_access'].every(k=>r[k]===true);
 }catch{return false;}
}
/** Next standalone changes cwd to <project>/<dist>/standalone at startup. */
export function recoveryArtifactPaths(cwd=process.cwd()):{proofPath:string;buildPath:string}{
 const dist=candidateBuildDirectory(),standalone=basename(cwd)==='standalone'&&basename(dirname(cwd))===dist;
 return {proofPath:resolve(cwd,standalone?'../../.image-source-proof.json':'.image-source-proof.json'),buildPath:resolve(cwd,dist,'BUILD_ID')};
}
/** Re-read the existing protected runtime file and image-local proof on every capability check. */
export async function readRecoveryCapability(pool:QueryPool,expected:PersonalConfig,paths:{runtimePath:string;proofPath:string;buildPath:string}={runtimePath:'/run/lifeos-platform/runtime.json',...recoveryArtifactPaths()}):Promise<{enabled:boolean;ownerAlias?:'owner'}>{
 try{
  const snapshot=()=>{
   const env=readReviewConfig(paths.runtimePath);if(!env.LIFEOS_PERSONAL_RECOVERY_APPROVAL||!readOwnerAccountAccess(env))return null;
   const platform=readPlatformConfig(env),personal=platform&&readPersonalConfig(env,platform);if(!personal||personal.ownerId!==expected.ownerId||personal.ownerEmail!==expected.ownerEmail||personal.spaceId!==expected.spaceId||personal.baseURL!==expected.baseURL||personal.databaseName!==expected.databaseName)return null;
   const raw=readFileSync(paths.proofPath);if(raw.length>2*1024*1024)return null;const proof=JSON.parse(raw.toString('utf8'));const buildId=readFileSync(paths.buildPath,'utf8').trim();
   if(!checkRecoveryApproval(JSON.parse(env.LIFEOS_PERSONAL_RECOVERY_APPROVAL),personal,proof,buildId))return null;
   return createHash('sha256').update(JSON.stringify([env,proof,buildId])).digest('hex');
  };
  const before=snapshot();if(!before||!await verifyRecoveryPermissions(pool))return{enabled:false};
  if(snapshot()!==before)return{enabled:false};
  return{enabled:true,ownerAlias:'owner'};
 }catch{return{enabled:false};}
}
