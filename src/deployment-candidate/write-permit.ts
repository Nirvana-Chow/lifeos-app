import {constants,openSync,closeSync,lstatSync,fstatSync,readFileSync,writeFileSync,fsyncSync,renameSync,unlinkSync,realpathSync} from 'node:fs';
import {isAbsolute,dirname,join,basename} from 'node:path';
import {randomUUID} from 'node:crypto';

export type WritePermitBinding={sourceSha:string;spaceId:string;configDigest:string};
const denied=():never=>{throw Error('WRITE_PERMIT_CLOSED');};
const trusted=(uid:number)=>uid===0||uid===process.getuid?.();
function validBinding(binding:WritePermitBinding):boolean{return !!binding&&/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(binding.sourceSha)&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(binding.spaceId)&&/^[0-9a-f]{64}$/.test(binding.configDigest);}
/** The gate directory is a separately provisioned private mount, never created here.
 * Root-owned files are accepted only if the runtime can actually open them. Host
 * activation and container UID/mount mapping still require site verification. */
function protectedPath(path:string):string{
 if(!isAbsolute(path)||basename(path)==='.'||basename(path)==='..')return denied();
 const parent=dirname(path),stat=lstatSync(parent);
 if(!stat.isDirectory()||stat.isSymbolicLink()||!trusted(stat.uid)||(stat.mode&0o777)!==0o700)return denied();
 let ancestor=parent;
 while(true){const s=lstatSync(ancestor);if(!s.isDirectory()||s.isSymbolicLink()||!trusted(s.uid)||((s.mode&0o022)!==0&&!(s.uid===0&&(s.mode&0o1000)!==0)))return denied();const next=dirname(ancestor);if(next===ancestor)break;ancestor=next;}
 return join(realpathSync(parent),basename(path));
}
function readObject(path:string):unknown{
 let fd:number|undefined;
 try{const resolved=protectedPath(path),before=lstatSync(resolved);fd=openSync(resolved,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=fstatSync(fd);
  if(!stat.isFile()||!trusted(stat.uid)||![0o400,0o600].includes(stat.mode&0o777)||stat.nlink!==1||stat.size<2||stat.size>2048||before.dev!==stat.dev||before.ino!==stat.ino)return denied();
  const raw=readFileSync(fd);if(raw.length>2048)return denied();const after=lstatSync(resolved);if(after.dev!==stat.dev||after.ino!==stat.ino||after.mtimeMs!==stat.mtimeMs||after.size!==stat.size)return denied();return JSON.parse(raw.toString('utf8'));
 }finally{if(fd!==undefined)closeSync(fd);}
}
/** No cache: every request and final transaction guard rereads this file. */
export function readWritePermit(path:string|undefined,binding:WritePermitBinding,now=new Date()):boolean{
 try{if(!path||!validBinding(binding)||!Number.isFinite(now.valueOf()))return false;const value=readObject(path) as Record<string,unknown>;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='activatedAt,configDigest,expiresAt,sourceSha,spaceId,version'||value.version!==1)return false;
  if(value.sourceSha!==binding.sourceSha||value.spaceId!==binding.spaceId||value.configDigest!==binding.configDigest||typeof value.activatedAt!=='string'||typeof value.expiresAt!=='string')return false;
  const start=Date.parse(value.activatedAt),end=Date.parse(value.expiresAt);return Number.isFinite(start)&&Number.isFinite(end)&&start<=now.valueOf()&&end>now.valueOf()&&end>start&&end-start<=900000;
 }catch{return false;}
}
export function assertWritePermit(path:string|undefined,binding:WritePermitBinding,now=new Date()):void{if(!readWritePermit(path,binding,now))denied();}
export async function activateWritePermit(path:string,binding:WritePermitBinding,checks:{targetReadOnlyHealthy:()=>Promise<boolean>;recheck:()=>Promise<boolean>},now=new Date(),ttlMs=300000):Promise<void>{
 if(!validBinding(binding)||!Number.isFinite(now.valueOf())||!Number.isInteger(ttlMs)||ttlMs<1||ttlMs>900000)denied();
 const resolved=protectedPath(path);
 if(!await checks.targetReadOnlyHealthy()||!await checks.recheck())denied();
 // Stage only after checks. Same-directory rename is the single activation point.
 const temporary=join(dirname(resolved),'.permit-'+randomUUID());let fd:number|undefined,renamed=false;
 try{if(protectedPath(path)!==resolved)denied();fd=openSync(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  writeFileSync(fd,JSON.stringify({version:1,...binding,activatedAt:now.toISOString(),expiresAt:new Date(now.valueOf()+ttlMs).toISOString()}));fsyncSync(fd);closeSync(fd);fd=undefined;
  renameSync(temporary,resolved);renamed=true;const directory=openSync(dirname(resolved),constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(directory);}finally{closeSync(directory);}assertWritePermit(path,binding,now);
 }catch(error){if(renamed){try{unlinkSync(resolved);}catch{/* Caller must treat an unconfirmed revocation as operator-required. */}}throw error;
 }finally{if(fd!==undefined)closeSync(fd);try{unlinkSync(temporary);}catch{/* Missing staging file is normal after rename. */}}
}
export function revokeWritePermit(path:string):void{const resolved=protectedPath(path);try{unlinkSync(resolved);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw Error('WRITE_PERMIT_REVOCATION_UNCONFIRMED');}try{lstatSync(resolved);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}throw Error('WRITE_PERMIT_REVOCATION_UNCONFIRMED');}
