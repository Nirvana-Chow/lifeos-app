import {createHash} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,readFileSync} from 'node:fs';
import {basename,dirname,resolve} from 'node:path';
import {candidateBuildDirectory} from '../platform/build-directory.ts';
import {currentReleaseSummary,publicReleaseRecords} from './records.ts';
export type ReleaseArtifact={sourceSha:string;sourceTreeDigest:string;buildId:string};
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function validateReleaseArtifact(proof:unknown,buildId:string,expectedSha:string|undefined):ReleaseArtifact|null{
 if(!obj(proof)||Object.keys(proof).sort().join(',')!=='files,sourceSha,sourceTreeDigest,version'||proof.version!==1||!expectedSha||!/^[a-f0-9]{40}$/.test(expectedSha)||proof.sourceSha!==expectedSha||!/^[A-Za-z0-9_-]{1,100}$/.test(buildId)||!Array.isArray(proof.files)||proof.files.length<5||proof.files.length>2000)return null;
 const paths:string[]=[];
 for(const file of proof.files){if(!obj(file)||Object.keys(file).sort().join(',')!=='path,sha256'||typeof file.path!=='string'||!/^[A-Za-z0-9_./@\[\]()-]+$/.test(file.path)||file.path.startsWith('/')||file.path.split('/').some(p=>!p||p==='.'||p==='..')||typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256))return null;paths.push(file.path);}
 if(new Set(paths).size!==paths.length||paths.some((p,i)=>i>0&&paths[i-1].localeCompare(p,'en')>=0)||!['package.json','package-lock.json','next.config.ts','proxy.ts','Dockerfile.platform-review'].every(p=>paths.includes(p)))return null;
 const digest=createHash('sha256').update(JSON.stringify(proof.files)).digest('hex');
 return proof.sourceTreeDigest===digest?{sourceSha:expectedSha,sourceTreeDigest:digest,buildId}:null;
}
function boundedFile(path:string,max:number):string{
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const st=fstatSync(fd);if(!st.isFile()||st.size>max)throw Error('Invalid release artifact');return readFileSync(fd,'utf8');}finally{closeSync(fd);}
}
/** Reads image-local metadata only. No runtime config, account data, Git, or network. */
export function readReleaseArtifact(cwd=process.cwd(),expectedSha=process.env.LIFEOS_REVIEW_GIT_SHA):ReleaseArtifact|null{
 try{const dist=candidateBuildDirectory(),standalone=basename(cwd)==='standalone'&&basename(dirname(cwd))===dist;return validateReleaseArtifact(JSON.parse(boundedFile(resolve(cwd,standalone?'../../.image-source-proof.json':'.image-source-proof.json'),2*1024*1024)),boundedFile(resolve(cwd,dist,'BUILD_ID'),128).trim(),expectedSha);}catch{return null;}
}
export function releaseNotes(artifact:ReleaseArtifact|null){
 const records=publicReleaseRecords.map(record=>({...record,sourceURL:'https://github.com/Nirvana-Chow/lifeos-app/commit/'+record.sourceSha,runningExactSource:artifact?.sourceSha===record.sourceSha}));
 // An exact historical record already describes its source; otherwise the image-local
 // descriptor is current only when the existing image proof reader supplies identity.
 if(artifact&&!records.some(record=>record.runningExactSource))records.unshift({...currentReleaseSummary,sourceSha:artifact.sourceSha,sourceURL:'https://github.com/Nirvana-Chow/lifeos-app/commit/'+artifact.sourceSha,runningExactSource:true});
 return{scope:'public-source-records' as const,current:artifact,records,ownerAccepted:false as const,visualQualification:'not-attested' as const};
}
