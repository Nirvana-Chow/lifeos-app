import {constants,openSync,closeSync,fstatSync,lstatSync,readSync,type BigIntStats} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateReviewConfig,applyReviewEnvironment} from '../platform/private-config.ts';

export type StartupMountProof=Readonly<{version:1;runtime:Readonly<{dev:string;ino:string;sha256:string}>;gate:Readonly<{dev:string;ino:string}>}>;
const fail=():never=>{throw Error('STARTUP_MOUNT_UNVERIFIED');};
function closed(value:unknown,keys:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return fail();
 const descriptors=Object.getOwnPropertyDescriptors(value),own=Reflect.ownKeys(value);
 if(own.length!==keys.length||own.some(k=>typeof k!=='string'||!keys.includes(k)))fail();
 for(const descriptor of Object.values(descriptors))if(!Object.hasOwn(descriptor,'value')||!descriptor.enumerable)fail();
 return Object.fromEntries(Object.entries(descriptors).map(([key,descriptor])=>[key,descriptor.value]));
}
const integer=(value:unknown,nonzero=false):value is string=>typeof value==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(value)&&BigInt(value)<=18446744073709551615n&&(!nonzero||BigInt(value)>0n);
export function parseStartupMountProof(value:unknown):StartupMountProof{
 try{
  const p=closed(value,['version','runtime','gate']),r=closed(p.runtime,['dev','ino','sha256']),g=closed(p.gate,['dev','ino']);
  if(p.version!==1||![r,g].every(v=>integer(v.dev)&&integer(v.ino,true))||typeof r.sha256!=='string'||!/^[0-9a-f]{64}$/.test(r.sha256))fail();
  return Object.freeze({version:1,runtime:Object.freeze({dev:r.dev,ino:r.ino,sha256:r.sha256}),gate:Object.freeze({dev:g.dev,ino:g.ino})}) as StartupMountProof;
 }catch{return fail();}
}
const identity=(s:BigIntStats)=>[s.dev,s.ino,s.mode,s.uid,s.gid,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
/** Only a protected file in the existing target gate carries this proof.
 * Never accept its JSON or digest through argv/environment. */
export function readStartupMountProof(fd:number):StartupMountProof{
 try{
  const before=fstatSync(fd,{bigint:true}),uid=process.getuid?.();
  if(uid===undefined||!before.isFile()||before.uid!==BigInt(uid)||before.nlink!==1n||(before.mode&0o777n)!==0o600n||before.size<2n||before.size>4096n)fail();
  const data=Buffer.alloc(4097);let length=0;
  while(length<data.length){const n=readSync(fd,data,length,data.length-length,length);if(!n)break;length+=n;}
  if(length>4096||BigInt(length)!==before.size||identity(before)!==identity(fstatSync(fd,{bigint:true})))fail();
  return parseStartupMountProof(JSON.parse(data.subarray(0,length).toString('utf8')));
 }catch{return fail();}
}
/** Descriptor inputs permit real temporary-file tests. Production opens only
 * the two fixed paths below. No path, digest, bytes or secret is logged. */
export function readBoundStartupConfig(expected:unknown,fds:{runtime:number;gate:number}):Record<string,string>{
 try{
  const p=parseStartupMountProof(expected),uid=process.getuid?.();if(uid===undefined)fail();
  const r=fstatSync(fds.runtime,{bigint:true}),g=fstatSync(fds.gate,{bigint:true});
  if(!r.isFile()||r.nlink!==1n||r.uid!==BigInt(uid!)||(r.mode&0o077n)!==0n||r.size<2n||r.size>16384n||!g.isDirectory()||g.uid!==BigInt(uid!)||(g.mode&0o777n)!==0o700n)fail();
  if(String(r.dev)!==p.runtime.dev||String(r.ino)!==p.runtime.ino||String(g.dev)!==p.gate.dev||String(g.ino)!==p.gate.ino)fail();
  const raw=Buffer.alloc(16385);let length=0;
  while(length<raw.length){const n=readSync(fds.runtime,raw,length,raw.length-length,length);if(!n)break;length+=n;}
  if(BigInt(length)!==r.size||length>16384||identity(r)!==identity(fstatSync(fds.runtime,{bigint:true}))||identity(g)!==identity(fstatSync(fds.gate,{bigint:true})))fail();
  const bytes=raw.subarray(0,length);if(createHash('sha256').update(bytes).digest('hex')!==p.runtime.sha256)fail();
  // Parse the measured bytes, never reopen a pathname after verification.
  const value=JSON.parse(bytes.toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))fail();
  return validateReviewConfig(value);
 }catch{return fail();}
}
export function applyBoundStartupConfig(config:Record<string,string>,env:Record<string,string|undefined>):void{
 const validated=validateReviewConfig(config);
 // The reviewed Docker environment must also exclude NODE_OPTIONS/preloads:
 // cleaning here cannot undo code that Node ran before this launcher.
 for(const key of Object.keys(env))if(key.startsWith('LIFEOS_')&&key!=='LIFEOS_REVIEW_GIT_SHA'||key.startsWith('RUN_')||['DATABASE_URL','RESTORE_DATABASE_URL','NODE_OPTIONS'].includes(key))delete env[key];
 applyReviewEnvironment(validated,env);
}
/** Fixed production mount targets; no CLI override or additional file source. */
export function loadControlledStartupEnvironment(env:Record<string,string|undefined>):void{
 let runtime:number|undefined,gate:number|undefined,proofFile:number|undefined;
 const gatePath='/run/lifeos-platform/write-gate',proofPath=gatePath+'/startup-proof.json';
 try{
  gate=openSync(gatePath,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const gateBefore=fstatSync(gate,{bigint:true});
  proofFile=openSync(proofPath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const proofBefore=fstatSync(proofFile,{bigint:true}),proof=readStartupMountProof(proofFile);
  runtime=openSync('/run/lifeos-platform/runtime.json',constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const config=readBoundStartupConfig(proof,{runtime,gate});
  if(identity(gateBefore)!==identity(fstatSync(gate,{bigint:true}))||identity(gateBefore)!==identity(lstatSync(gatePath,{bigint:true}))||identity(proofBefore)!==identity(fstatSync(proofFile,{bigint:true}))||identity(proofBefore)!==identity(lstatSync(proofPath,{bigint:true})))fail();
  applyBoundStartupConfig(config,env);
 }catch{return fail();}finally{if(proofFile!==undefined)closeSync(proofFile);if(gate!==undefined)closeSync(gate);if(runtime!==undefined)closeSync(runtime);}
}
