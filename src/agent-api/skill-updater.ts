import {createHash} from 'node:crypto';
import {readSkillManifest,verifySkillRelease,skillUpdateOrigin} from './skill-update-channel.ts';
import {withStoreLock,recoverStore,inspectStore,activateDocuments,type UpdateStore} from './local-skill-update/store.ts';

export const skillManifestURL=skillUpdateOrigin+'/api/platform/agent-skill/manifest';
export type SkillUpdateOptions=UpdateStore&{
  apiVersion:number;
  /** Trusted host integration seam; production defaults to platform fetch. */
  fetcher?:(url:string,options:RequestInit)=>Promise<Response>;
  /** Optional already-reviewed host check. Never supplied by downloaded docs. */
  validateInstalled?:(path:string)=>Promise<void>;
};
async function download(url:string,limit:number,contentType:string,fetcher:NonNullable<SkillUpdateOptions['fetcher']>){
  const parsed=new URL(url);
  if(parsed.origin!==skillUpdateOrigin||parsed.username||parsed.password||parsed.search||parsed.hash)throw Error('update URL rejected');
  const response=await fetcher(url,{
    method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10000),
    headers:{Accept:contentType},
  });
  if(response.status!==200||response.redirected||(response.url&&response.url!==url))throw Error('update HTTP/redirect rejected');
  if(response.headers.get('content-type')?.split(';')[0].trim()!==contentType)throw Error('update content type rejected');
  const length=response.headers.get('content-length');
  if(length&&(!/^\d+$/.test(length)||Number(length)>limit))throw Error('update response size rejected');
  const reader=response.body?.getReader();if(!reader)throw Error('update response body missing');
  const chunks:Uint8Array[]=[];let count=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>limit)throw Error('update response size rejected');chunks.push(value);}}
  catch(cause){await reader.cancel().catch(()=>undefined);throw cause;}
  finally{reader.releaseLock();}
  return Buffer.concat(chunks,count);
}

/** On-demand only. The owner-approved fixed HTTPS publisher is the existing
 * documentation trust root. Hashes verify transport/package consistency; they
 * are not independent signatures. No source URL or policy comes from records. */
export async function updateSkillBeforeUse(options:SkillUpdateOptions){
  return withStoreLock(options,async()=>{
    await recoverStore(options);
    const current=await inspectStore(options);
    const manifestBytes=await download(skillManifestURL,16384,'application/json',options.fetcher??fetch);
    const manifest=readSkillManifest(manifestBytes,options.apiVersion);
    const manifestSha256=createHash('sha256').update(manifestBytes).digest('hex');
    const marks=[current.highwater,current.metadata].filter(Boolean);
    for(const mark of marks){
      if(manifest.releaseSequence<mark.sequence)throw Error('release rollback rejected');
      if(manifest.releaseSequence===mark.sequence&&manifestSha256!==mark.manifestSha256)throw Error('same release sequence substitution rejected');
    }
    if(current.metadata?.sequence===manifest.releaseSequence){
      const latest=await inspectStore(options);
      if(latest.directory!==current.directory||latest.publicFingerprint!==current.publicFingerprint)throw Error('local Skill changed during manifest download; preserve and review');
      // Trusted local overlay edits remain current; only public docs/target are fixed.
      if(options.validateInstalled)await options.validateInstalled(options.skillDirectory);
      return {status:'current' as const,releaseSequence:manifest.releaseSequence,manifestSha256,skillDirectory:options.skillDirectory,versionDirectory:latest.directory};
    }
    const archive=await download(skillUpdateOrigin+manifest.archive.path,256*1024,'application/gzip',options.fetcher??fetch);
    const verified=verifySkillRelease(manifestBytes,archive,{trustedManifestSha256:manifestSha256,apiVersion:options.apiVersion});
    const latest=await inspectStore(options);
    if(latest.directory!==current.directory||latest.publicFingerprint!==current.publicFingerprint)throw Error('local Skill changed during download; preserve and review');
    const versionDirectory=await activateDocuments(options,verified,latest,options.validateInstalled);
    return {status:'updated' as const,releaseSequence:manifest.releaseSequence,manifestSha256,skillDirectory:options.skillDirectory,versionDirectory};
  });
}

/** Host entry: checking/updating and loading the resulting Skill happen before
 * the caller obtains its business-operation instructions. No business API call
 * or executable runtime is dispatched by this adapter. */
export async function withUpdatedLifeOSSkill<T>(options:SkillUpdateOptions,useSkill:(path:string)=>Promise<T>):Promise<T>{
  const result=await updateSkillBeforeUse(options);
  return useSkill(result.versionDirectory);
}
