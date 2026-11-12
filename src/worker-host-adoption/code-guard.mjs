import {readFileSync,readdirSync,lstatSync,realpathSync,openSync,fstatSync,closeSync,constants} from 'node:fs';
import {createHash} from 'node:crypto';import {resolve,relative,dirname,join} from 'node:path';import {fileURLToPath} from 'node:url';import {registerHooks} from 'node:module';
const codeHash=bytes=>createHash('sha256').update(bytes).digest('hex');
function pinnedBytes(path){const s=lstatSync(path);if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o022)||s.nlink!==1)throw Error('UNSAFE_CODE_FILE');const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const f=fstatSync(fd);if(f.ino!==s.ino||f.dev!==s.dev)throw Error('CODE_FILE_CHANGED');return readFileSync(fd);}finally{closeSync(fd);}}
function codeDirectory(path){const s=lstatSync(path);if(!s.isDirectory()||s.uid!==process.getuid()||(s.mode&0o022))throw Error('UNSAFE_CODE_DIRECTORY');}
function tree(path,prefix,files,dirs){codeDirectory(path);dirs.push(prefix);for(const item of readdirSync(path,{withFileTypes:true})){const name=prefix+'/'+item.name;if(item.isDirectory())tree(join(path,item.name),name,files,dirs);else if(item.isFile())files.push(name);else throw Error('NONREGULAR_CODE_ENTRY');}}
const rootCode=/\.(?:mjs|cjs|js|mts|cts|ts|node)$/;
export function establishCodeBoundary(root,manifestSHA){
 root=resolve(root);if(realpathSync(root)!==root)throw Error('CODE_ROOT_ALIAS_REJECTED');codeDirectory(root);
 const raw=pinnedBytes(join(root,'code-manifest.json'));if(codeHash(raw)!==manifestSHA)throw Error('CODE_MANIFEST_REJECTED');const manifest=JSON.parse(raw);
 // Node may search every importing module's ancestors. Inside these exact trees
 // every directory/file is pinned; outside the root no ancestor node_modules is allowed.
 const actualFiles=[],actualDirs=[];for(const name of manifest.closedDirectories)tree(join(root,name),name,actualFiles,actualDirs);
 const expectedTree=Object.keys(manifest.files).filter(name=>manifest.closedDirectories.some(dir=>name.startsWith(dir+'/'))).sort();
 if(JSON.stringify(actualFiles.sort())!==JSON.stringify(expectedTree)||JSON.stringify(actualDirs.sort())!==JSON.stringify([...manifest.directories].sort()))throw Error('EXTRA_OR_MISSING_CODE_ENTRY');
 for(const item of readdirSync(root,{withFileTypes:true})){if(rootCode.test(item.name)&&!Object.hasOwn(manifest.files,item.name)&&!manifest.outerPinnedEntries.includes(item.name))throw Error('UNPINNED_ROOT_CODE');}
 let parent=dirname(root);for(;;){try{lstatSync(join(parent,'node_modules'));throw Error('ANCESTOR_NODE_MODULES_REJECTED');}catch(error){if(error.code!=='ENOENT')throw error;}const next=dirname(parent);if(next===parent)break;parent=next;}
 for(const [name,sha] of Object.entries(manifest.files)){if(name.startsWith('/')||name.split('/').includes('..')||name.includes('\\')||codeHash(pinnedBytes(join(root,name)))!==sha)throw Error('CODE_HASH_REJECTED');}
 function allowed(url){const parsed=new URL(url);if(parsed.protocol!=='file:'||parsed.search||parsed.hash)throw Error('CODE_URL_REJECTED');const path=fileURLToPath(parsed);if(realpathSync(path)!==path)throw Error('CODE_ALIAS_REJECTED');const name=relative(root,path);if(name.startsWith('..')||!Object.hasOwn(manifest.files,name))throw Error('UNPINNED_MODULE_RESOLUTION');return{name,path};}
 const packageMetadata=Object.keys(manifest.files).filter(name=>name==='package.json'||name.endsWith('/package.json'));
 function auditMetadata(url){
  for(const name of packageMetadata)if(codeHash(pinnedBytes(join(root,name)))!==manifest.files[name])throw Error('PACKAGE_METADATA_CHANGED');
  if(!url?.startsWith('file:'))return;let directory=dirname(fileURLToPath(url));const inside=relative(root,directory);if(inside.startsWith('..'))return;
  for(;;){const path=join(directory,'package.json');try{lstatSync(path);const name=relative(root,path);if(!Object.hasOwn(manifest.files,name))throw Error('UNPINNED_PACKAGE_METADATA');if(codeHash(pinnedBytes(path))!==manifest.files[name])throw Error('PACKAGE_METADATA_CHANGED');}catch(error){if(error.code!=='ENOENT')throw error;}if(directory===root)break;directory=dirname(directory);}
 }
 // Hash the bytes that are actually supplied to Node, rather than trusting a
 // preceding file check. This also covers CJS/dynamic imports in SDK code.
 registerHooks({resolve(specifier,context,next){auditMetadata(context.parentURL);const result=next(specifier,context);if(!result.url.startsWith('node:')){allowed(result.url);auditMetadata(result.url);}return result;},load(url,context,next){if(url.startsWith('node:'))return next(url,context);const {name,path}=allowed(url);auditMetadata(url);if(path.endsWith('.node'))throw Error('NATIVE_ADDON_REJECTED');const bytes=pinnedBytes(path);if(codeHash(bytes)!==manifest.files[name])throw Error('MODULE_BYTES_CHANGED');const loaded=next(url,context);if(!['module','commonjs','module-typescript','commonjs-typescript','json'].includes(loaded.format))throw Error('MODULE_FORMAT_REJECTED');return{...loaded,source:bytes,shortCircuit:true};}});
 return manifest;
}
