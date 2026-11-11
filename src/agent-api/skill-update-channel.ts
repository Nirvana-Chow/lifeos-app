import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {buildSkillArtifact} from './skill-artifact.ts';
import {skillArtifactFiles} from './skill-artifact-content.generated.ts';

// Shared public release format. Download/install transport lives in the trusted local host adapter.
export const skillUpdateOrigin='https://lifeos.nirvanachow.com';
export const skillDocumentPaths=['LICENSE','SKILL.md','references/credential-runtime.md','references/operations.md'] as const;
const maxArchive=256*1024;
const maxExpanded=512*1024;
const maxManifest=16*1024;
const origin=skillUpdateOrigin;
const paths=skillDocumentPaths;
export const skillReleaseSequence=2026111201;
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const hex=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const bounded=(value:unknown,limit:number):value is number=>Number.isSafeInteger(value)&&Number(value)>0&&Number(value)<=limit;
function requireValue(value:unknown,message:string):asserts value { if(!value)throw Error(message); }
function record(value:unknown,keys:string[]):Record<string,unknown> {
  requireValue(value!==null&&typeof value==='object'&&!Array.isArray(value),'invalid manifest object');
  const result=value as Record<string,unknown>;
  requireValue(Object.keys(result).sort().join('|')===[...keys].sort().join('|'),'invalid manifest fields');
  return result;
}

export function buildSkillRelease() {
  const archive=buildSkillArtifact();
  const digest=hash(archive);
  const manifest={
    schemaVersion:1,releaseSequence:skillReleaseSequence,skill:'lifeos-agent',origin,releaseId:'sha256:'+digest,apiVersions:[1,2],
    archive:{path:'/api/platform/agent-skill/releases/'+digest+'.tar.gz',format:'tar.gz',sha256:digest,bytes:archive.length},
    files:paths.map(path=>{const bytes=Buffer.from(skillArtifactFiles[path]);return {path,sha256:hash(bytes),bytes:bytes.length};}),
  };
  const manifestBytes=Buffer.from(JSON.stringify(manifest)+'\n');
  return {manifestBytes,archive,manifestSha256:hash(manifestBytes)};
}

export type SkillReleaseManifest={schemaVersion:1;releaseSequence:number;skill:'lifeos-agent';origin:string;releaseId:string;apiVersions:number[];archive:{path:string;format:'tar.gz';sha256:string;bytes:number};files:{path:string;sha256:string;bytes:number}[]};

export function readSkillManifest(manifestBytes:Uint8Array,apiVersion:number):SkillReleaseManifest {
  requireValue(manifestBytes.length>0&&manifestBytes.length<=maxManifest,'manifest size rejected');
  const manifest=record(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes)),['schemaVersion','releaseSequence','skill','origin','releaseId','apiVersions','archive','files']);
  requireValue(bounded(manifest.releaseSequence,Number.MAX_SAFE_INTEGER),'release sequence rejected');
  requireValue(manifest.schemaVersion===1&&manifest.skill==='lifeos-agent'&&manifest.origin===origin,'manifest identity rejected');
  requireValue(Array.isArray(manifest.apiVersions)&&manifest.apiVersions.length===2&&manifest.apiVersions[0]===1&&manifest.apiVersions[1]===2&&manifest.apiVersions.includes(apiVersion),'API compatibility rejected');
  const archive=record(manifest.archive,['path','format','sha256','bytes']);
  requireValue(hex(archive.sha256)&&archive.format==='tar.gz'&&bounded(archive.bytes,maxArchive),'archive metadata rejected');
  requireValue(manifest.releaseId==='sha256:'+archive.sha256&&archive.path==='/api/platform/agent-skill/releases/'+archive.sha256+'.tar.gz','release identity/path rejected');
  requireValue(Array.isArray(manifest.files)&&manifest.files.length===paths.length,'manifest file allowlist rejected');
  const files=manifest.files.map((value,index)=>{
    const file=record(value,['path','sha256','bytes']);
    requireValue(file.path===paths[index]&&hex(file.sha256)&&bounded(file.bytes,maxExpanded),'manifest file rejected');
    return file;
  });
  return manifest as unknown as SkillReleaseManifest;
}

/** Integrity verifier. The expected digest may come from reviewed source, or
 * the fixed pre-authorized HTTPS publisher through the trusted local adapter.
 * A hash does not independently authenticate the publisher. */
export function verifySkillRelease(manifestBytes:Uint8Array,archiveBytes:Uint8Array,options:{trustedManifestSha256:string;apiVersion:number}) {
  requireValue(hex(options.trustedManifestSha256)&&hash(manifestBytes)===options.trustedManifestSha256,'manifest trust rejected');
  const manifest=readSkillManifest(manifestBytes,options.apiVersion);
  requireValue(archiveBytes.length===manifest.archive.bytes&&hash(archiveBytes)===manifest.archive.sha256,'archive integrity rejected');
  const files=manifest.files;
  const documents:Record<string,string>={};
  // Parse only the existing regular-file format into memory; never call tar or
  // materialize paths. Reject links, duplicates, extension entries and trailers.
  const tar=gunzipSync(archiveBytes,{maxOutputLength:maxExpanded});
  let offset=0;
  for(const file of files) {
    requireValue(offset+512<=tar.length,'archive header missing');
    const header=tar.subarray(offset,offset+512);
    const field=(start:number,length:number)=>header.subarray(start,start+length).toString('latin1').replace(/\0.*$/s,'');
    const octal=(start:number,length:number)=>{const text=field(start,length).trim();requireValue(/^[0-7]+$/.test(text),'archive number rejected');return parseInt(text,8);};
    const checksum=octal(148,8);
    const actual=header.reduce((sum,byte,index)=>sum+(index>=148&&index<156?32:byte),0);
    requireValue(checksum===actual&&field(0,100)==='lifeos-agent/'+file.path&&field(156,1)==='0'&&field(157,100)===''&&field(345,155)===''&&field(257,6)==='ustar','archive file type/path rejected');
    requireValue(octal(100,8)===0o644,'archive mode rejected');
    const size=octal(124,12);
    requireValue(size===file.bytes&&offset+512+size<=tar.length,'archive file size rejected');
    const content=tar.subarray(offset+512,offset+512+size);
    requireValue(hash(content)===file.sha256,'archive file integrity rejected');
    documents[file.path]=new TextDecoder('utf-8',{fatal:true}).decode(content);
    const next=offset+512+Math.ceil(size/512)*512;
    requireValue(tar.subarray(offset+512+size,next).every(byte=>byte===0),'archive padding rejected');
    offset=next;
  }
  requireValue(tar.length===offset+1024&&tar.subarray(offset).every(byte=>byte===0),'archive extra/missing entries rejected');
  return {status:'verified-not-installed' as const,releaseId:manifest.releaseId as string,archiveURL:origin+manifest.archive.path,manifestSha256:options.trustedManifestSha256,releaseSequence:manifest.releaseSequence,documents};
}
