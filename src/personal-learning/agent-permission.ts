import {PlatformError} from '../platform/domain.ts';
import type {SqlClient} from '../platform/postgres.ts';
import type {Binding} from './domain.ts';

export const learningGrantVersion = 'learning-v1';
export const learningReadScope = 'learning:read';
export const learningWriteScope = 'learning:write';
export const learningWebVersion = 'learning-vocabulary-v1';

export function learningGrantScopes(metadata:unknown,permissions:unknown):readonly (typeof learningReadScope|typeof learningWriteScope)[]|null {
 if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)||Object.keys(metadata).sort().join(',')!=='learningAccess,spaceId'||
    !('learningAccess' in metadata)||metadata.learningAccess!==learningGrantVersion||
    !permissions||typeof permissions!=='object'||Array.isArray(permissions)||Object.keys(permissions).join(',')!=='learning'||
    !('learning' in permissions)||!Array.isArray(permissions.learning))return null;
 const actions=permissions.learning;
 if(actions.length===1&&actions[0]==='read')return [learningReadScope];
 if(actions.length===2&&actions[0]==='read'&&actions[1]==='write')return [learningReadScope,learningWriteScope];
 return null;
}

export const learningFenceDigest = '3584981714a4fe5c87a5dfa52852afc426f206a1f7132ee6505f4c45a1ce2ee5';
export async function learningFenceReady(pool:{query:(sql:string,values:string[])=>Promise<{rows:Record<string,unknown>[]}>}):Promise<boolean>{
 const {rows}=await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
   WHERE current_user='lifeos_platform_candidate_runtime'
     AND p.oid=to_regprocedure('lifeos_agent.assert_learning_grant(text,text,text,text[],text)')
     AND p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
     AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=$1
     AND p.proowner=(SELECT relowner FROM pg_catalog.pg_class WHERE oid=to_regclass('lifeos_agent.apikey'))
     AND p.proacl IS NOT NULL AND has_function_privilege(current_user,p.oid,'EXECUTE')
     AND NOT EXISTS(SELECT 1 FROM aclexplode(p.proacl) a
       WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner
         AND (a.is_grantable OR a.grantee<>(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=current_user)))) AS ready`,[learningFenceDigest]);
 return rows.length===1&&rows[0].ready===true;
}

export async function assertLearningWriteFence(client:SqlClient,binding:Binding,grantId:string,operationId:string,scopes:readonly string[]) {
 const {rows}=await client.query('SELECT lifeos_agent.assert_learning_grant($1,$2,$3,$4,$5) AS allowed',
   [grantId,binding.ownerId,binding.spaceId,[...scopes],operationId]);
 if(rows.length!==1||rows[0].allowed!==true)throw new PlatformError(403,'WRITE_GRANT_REVOKED','学习授权已失效。');
}
