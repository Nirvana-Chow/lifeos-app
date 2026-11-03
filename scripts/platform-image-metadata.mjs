// Build-time only. The complete immutable image ID must later be bound to this
// source proof and reviewed reader capabilities in a separate approval receipt.
import{readFileSync,writeFileSync,readdirSync,lstatSync,existsSync}from'node:fs';
import{createHash}from'node:crypto';
import{join}from'node:path';
export function sourceImageProof(root,sourceSha){
 if(!/^[0-9a-f]{40}$/.test(sourceSha??''))throw Error('Fixed SOURCE_COMMIT is required');
 const files=[];const add=path=>{const stat=lstatSync(join(root,path));if(!stat.isFile()||stat.isSymbolicLink())throw Error('Unreviewed build source');files.push({path,sha256:createHash('sha256').update(readFileSync(join(root,path))).digest('hex')});};
 const walk=dir=>{for(const name of readdirSync(join(root,dir)).sort()){const path=dir+'/'+name,st=lstatSync(join(root,path));if(st.isSymbolicLink())throw Error('Unreviewed build symlink');if(st.isDirectory())walk(path);else add(path);if(files.length>2000)throw Error('Build source limit');}};
 // Root configuration is build input too. Never read credential-bearing files.
 for(const name of readdirSync(root).sort()){
  if(name==='.image-source-proof.json')continue;
  if(/^\.env(?:\.|$)|^\.npmrc$|\.(pem|key)$/.test(name))throw Error('Private build input is forbidden');
  const st=lstatSync(join(root,name));if(/\.(?:[cm]?js|json|tsx?)$/.test(name)||name==='Dockerfile.platform-review'||name==='.dockerignore'){if(st.isSymbolicLink())throw Error('Unreviewed root build symlink');add(name);}
 }
 for(const required of ['package.json','package-lock.json','next.config.ts','proxy.ts','Dockerfile.platform-review'])if(!files.some(f=>f.path===required))throw Error('Missing required build input');
 for(const dir of ['app','src','scripts','components','db','public'])if(existsSync(join(root,dir)))walk(dir);else if(['app','src','scripts'].includes(dir))throw Error('Missing runtime source directory');
 files.sort((a,b)=>a.path.localeCompare(b.path,'en'));return{version:1,sourceSha,sourceTreeDigest:createHash('sha256').update(JSON.stringify(files)).digest('hex'),files};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 const proof=sourceImageProof(process.cwd(),process.argv[2]);writeFileSync('.image-source-proof.json',JSON.stringify(proof));console.log(JSON.stringify({sourceSha:proof.sourceSha,sourceTreeDigest:proof.sourceTreeDigest,fileCount:proof.files.length}));
}
