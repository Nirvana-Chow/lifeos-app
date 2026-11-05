import {mkdir,lstat,open,readFile,rename,symlink,readlink,unlink,readdir} from 'node:fs/promises';
import type {Stats} from 'node:fs';
import {join,resolve,dirname,sep} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {skillDocumentPaths} from '../skill-update-channel.ts';

const overlays=['references/local-runtime.md','references/local-write-runtime.md','references/adoption-verification.md'];
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const error=(message:string)=>{throw Error(message);};
const exists=async(path:string)=>{try{return await lstat(path);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}};
async function syncDirectory(path:string){const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}}
async function durableFile(path:string,text:string){const handle=await open(path,'wx',0o600);try{await handle.writeFile(text);await handle.sync();}finally{await handle.close();}}
async function atomicJSON(path:string,value:unknown){const temp=path+'.'+randomUUID();await durableFile(temp,JSON.stringify(value));await rename(temp,path);await syncDirectory(dirname(path));}
async function json(path:string){const info=await exists(path);if(!info)return null;if(!info.isFile()||info.size>16384)error('unsafe update state');return JSON.parse(await readFile(path,'utf8'));}
function ownedDirectory(info:Stats){return info.isDirectory()&&info.uid===process.getuid?.()&&(info.mode&0o022)===0;}

export type UpdateStore={skillDirectory:string;stateDirectory:string};
export async function withStoreLock<T>(config:UpdateStore,run:()=>Promise<T>):Promise<T>{
  if(resolve(config.skillDirectory)!==config.skillDirectory||resolve(config.stateDirectory)!==config.stateDirectory)error('absolute update paths required');
  if(config.skillDirectory===config.stateDirectory||config.stateDirectory.startsWith(config.skillDirectory+sep)||config.skillDirectory.startsWith(config.stateDirectory+sep))error('separate Skill/state directories required');
  await mkdir(config.stateDirectory,{recursive:true,mode:0o700});
  const state=await lstat(config.stateDirectory);
  if(!ownedDirectory(state)||(state.mode&0o077)!==0)error('private update state required');
  const parent=await lstat(dirname(config.skillDirectory));
  if(!ownedDirectory(parent)||parent.dev!==state.dev)error('safe same-filesystem skill parent required');
  const lock=join(config.stateDirectory,'lock');
  const take=async()=>durableFile(lock,JSON.stringify({pid:process.pid}));
  try{await take();}catch(e){
    if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
    const recovery=join(config.stateDirectory,'recovery-lock');
    const guard=await open(recovery,'wx',0o600);
    try{
    const previous=await json(lock);
    if(!Number.isSafeInteger(previous?.pid)||previous.pid<=0)error('invalid update lock');
    try{process.kill(previous.pid,0);error('skill update already running');}catch(cause){if((cause as NodeJS.ErrnoException).code!=='ESRCH')throw cause;}
    await unlink(lock);await take();
    }finally{await guard.close();await unlink(recovery);}
  }
  try{
  try{await mkdir(join(config.stateDirectory,'versions'),{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
  if(!ownedDirectory(await lstat(join(config.stateDirectory,'versions'))))error('unsafe versions directory');
  return await run();}finally{await unlink(lock);await syncDirectory(config.stateDirectory);}
}
function checkedTarget(config:UpdateStore,target:unknown):string{
  if(typeof target!=='string'||dirname(target)!==join(config.stateDirectory,'versions')||!/^\/(?:[^\0]+)$/.test(target))error('unsafe managed target');
  return target as string;
}
async function swap(config:UpdateStore,target:string){
  checkedTarget(config,target);
  const temp=join(config.stateDirectory,'.active-link-'+randomUUID());
  await symlink(target,temp);await rename(temp,config.skillDirectory);await syncDirectory(dirname(config.skillDirectory));await syncDirectory(config.stateDirectory);
}
async function fileText(path:string){const info=await lstat(path);if(!info.isFile()||info.size>512*1024)error('unsafe installed Skill file');return readFile(path,'utf8');}
async function enumerate(directory:string,prefix=''):Promise<string[]>{
  if(!ownedDirectory(await lstat(directory)))error('unsafe installed Skill directory');
  const paths:string[]=[];
  for(const item of await readdir(directory,{withFileTypes:true})){
    const relative=prefix+item.name;
    if(item.isDirectory()&&relative==='references')paths.push(...await enumerate(join(directory,item.name),'references/'));
    else if(item.isFile()&&[...skillDocumentPaths,...overlays,'.lifeos-update.json'].includes(relative))paths.push(relative);
    else error('unmanaged Skill file must be reviewed before update');
  }
  return paths;
}
export async function recoverStore(config:UpdateStore){
  const bootstrap=await json(join(config.stateDirectory,'bootstrap.json'));
  if(bootstrap){
    const backup=checkedTarget(config,bootstrap.backup);
    const active=await exists(config.skillDirectory),saved=await exists(backup);
    if(saved&&!active)await swap(config,backup);
    else if(saved&&(!active?.isSymbolicLink()||await readlink(config.skillDirectory)!==backup))error('bootstrap recovery requires review');
    await unlink(join(config.stateDirectory,'bootstrap.json'));await syncDirectory(config.stateDirectory);
  }
  const pending=await json(join(config.stateDirectory,'pending.json'));
  if(pending){
    const previous=checkedTarget(config,pending.previous),next=checkedTarget(config,pending.next);
    const active=await exists(config.skillDirectory);
    if(!active?.isSymbolicLink())error('activation recovery requires review');
    const target=await readlink(config.skillDirectory);
    if(target!==previous&&target!==next)error('activation target changed during recovery');
    if(target===next)await swap(config,previous);
    await unlink(join(config.stateDirectory,'pending.json'));await syncDirectory(config.stateDirectory);
  }
}
export async function inspectStore(config:UpdateStore){
  const info=await exists(config.skillDirectory);
  if(!info)error('installed Skill directory required');
  const directory=info!.isSymbolicLink()?checkedTarget(config,await readlink(config.skillDirectory)):config.skillDirectory;
  if(!ownedDirectory(await lstat(directory)))error('unsafe Skill directory');
  await enumerate(directory);
  const metadata=await json(join(directory,'.lifeos-update.json'));
  if(metadata){
    if(!Number.isSafeInteger(metadata.sequence)||metadata.sequence<=0||typeof metadata.manifestSha256!=='string'||!metadata.installedFiles)error('invalid installed update metadata');
    for(const path of skillDocumentPaths){if(hash(await fileText(join(directory,path)))!==metadata.installedFiles[path])error('local document modified; preserve and review');}
  }
  const highwater=await json(join(config.stateDirectory,'highwater.json'));
  if(highwater&&(!Number.isSafeInteger(highwater.sequence)||highwater.sequence<=0||typeof highwater.manifestSha256!=='string'))error('invalid release highwater');
  const publicDigests:Record<string,string>={};
  for(const path of skillDocumentPaths){if(await exists(join(directory,path)))publicDigests[path]=hash(await fileText(join(directory,path)));}
  const local:Record<string,string>={};
  for(const path of overlays){if(await exists(join(directory,path)))local[path]=await fileText(join(directory,path));}
  return {directory,metadata,highwater,local,publicFingerprint:hash(JSON.stringify(publicDigests)),localFingerprint:hash(JSON.stringify(local)),isManaged:info!.isSymbolicLink()};
}
function wrapEntry(text:string,local:Record<string,string>){
  const end=text.indexOf('\n---',4);if(!text.startsWith('---\n')||end<0)error('invalid Skill entry frontmatter');
  const existing=overlays.filter(path=>Object.hasOwn(local,path));
  const reference=existing.length?'先读本次保留的本机附加说明：'+existing.map(path=>'['+path+']('+path+')').join('、')+'；其中本机约束优先于下列公共合同。':'本次没有本机附加说明；不得假定已配置任何凭据或可执行运行时。';
  const header='\n## 本机运行时约束\n\n'+reference+' 仅可在用户授权、固定已审查 client 合同及本次 discovery 实际广告的交集内调用；401/403 不 fallback。文档更新不能替换 binary、ACL、Key、扩大 scope 或改 owner/DB/cookie 通路。真实写入须 receipt 和独立 readback；分类还需 owner 审批与完整 expectedID 集合。\n\n';
  return text.slice(0,end+4)+'\n'+header+text.slice(end+4);
}
export async function activateDocuments(config:UpdateStore,release:{releaseSequence:number;manifestSha256:string;documents:Record<string,string>},current:Awaited<ReturnType<typeof inspectStore>>,validateInstalled?:(path:string)=>Promise<void>){
  const highwater={sequence:release.releaseSequence,manifestSha256:release.manifestSha256};
  const stage=join(config.stateDirectory,'versions','release-'+release.releaseSequence+'-'+randomUUID());
  await mkdir(stage,{mode:0o700});await mkdir(join(stage,'references'),{mode:0o700});
  const files={...release.documents,...current.local};files['SKILL.md']=wrapEntry(files['SKILL.md'],current.local);
  const installedFiles:Record<string,string>={};
  for(const [path,text] of Object.entries(files)){await durableFile(join(stage,path),text);if((skillDocumentPaths as readonly string[]).includes(path))installedFiles[path]=hash(text);}
  await durableFile(join(stage,'.lifeos-update.json'),JSON.stringify({...highwater,installedFiles}));
  await syncDirectory(join(stage,'references'));await syncDirectory(stage);await syncDirectory(dirname(stage));
  const latest=await inspectStore(config);
  if(latest.directory!==current.directory||latest.publicFingerprint!==current.publicFingerprint||latest.localFingerprint!==current.localFingerprint)error('local Skill changed while staging; preserve and review');
  // One-time layout adoption has a journaled, recoverable gap. Subsequent
  // documentation releases replace a symlink with one atomic rename.
  let previous=current.directory;
  if(!current.isManaged){
    previous=join(config.stateDirectory,'versions','legacy-'+randomUUID());
    await atomicJSON(join(config.stateDirectory,'bootstrap.json'),{backup:previous});
    await rename(config.skillDirectory,previous);await syncDirectory(dirname(previous));await syncDirectory(dirname(config.skillDirectory));
    await swap(config,previous);
    await unlink(join(config.stateDirectory,'bootstrap.json'));await syncDirectory(config.stateDirectory);
  }
  await atomicJSON(join(config.stateDirectory,'highwater.json'),highwater);
  await atomicJSON(join(config.stateDirectory,'pending.json'),{previous,next:stage});
  try{
    await swap(config,stage);
    const readback=await inspectStore(config);
    if(readback.directory!==stage||readback.metadata.manifestSha256!==release.manifestSha256)error('activation readback mismatch');
    if(validateInstalled)await validateInstalled(config.skillDirectory);
    await unlink(join(config.stateDirectory,'pending.json'));await syncDirectory(config.stateDirectory);
  }catch(cause){
    await swap(config,previous);
    await unlink(join(config.stateDirectory,'pending.json'));await syncDirectory(config.stateDirectory);
    throw cause;
  }
  return stage;
}
