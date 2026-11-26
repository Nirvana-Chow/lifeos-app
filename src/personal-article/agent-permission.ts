export const articleGrantVersion = 'article-v1';
export const articleReadScope = 'article:read';
export const articleWriteScope = 'article:write';

export function articleGrantScopes(metadata:unknown,permissions:unknown):readonly (typeof articleReadScope|typeof articleWriteScope)[]|null {
 if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)||Object.keys(metadata).sort().join(',')!=='articleAccess,spaceId'||
    !('articleAccess' in metadata)||metadata.articleAccess!==articleGrantVersion||
    !permissions||typeof permissions!=='object'||Array.isArray(permissions)||Object.keys(permissions).join(',')!=='article'||
    !('article' in permissions)||!Array.isArray(permissions.article))return null;
 const actions=permissions.article;
 if(actions.length===1&&actions[0]==='read')return [articleReadScope];
 if(actions.length===2&&actions[0]==='read'&&actions[1]==='write')return [articleReadScope,articleWriteScope];
 return null;
}

/** Qualify the dedicated lock without enabling the general business catalog. */
export async function articleFenceReady(pool:{query:(sql:string)=>Promise<{rows:{ready?:unknown}[]}>}):Promise<boolean>{
 const {rows}=await pool.query(`SELECT EXISTS(SELECT 1 FROM pg_proc p
   WHERE p.oid=to_regprocedure('lifeos_agent.assert_article_grant(text,text,text,text[],text)')
     AND p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
     AND p.proowner=(SELECT relowner FROM pg_class WHERE oid=to_regclass('lifeos_agent.apikey'))
     AND p.proacl IS NOT NULL AND has_function_privilege(current_user,p.oid,'EXECUTE')
     AND NOT EXISTS(SELECT 1 FROM aclexplode(p.proacl) a
       WHERE a.privilege_type='EXECUTE' AND a.grantee<>p.proowner
         AND (a.is_grantable OR a.grantee<>(SELECT oid FROM pg_roles WHERE rolname='lifeos_platform_candidate_runtime')))) AS ready`);
 return rows[0]?.ready===true;
}
