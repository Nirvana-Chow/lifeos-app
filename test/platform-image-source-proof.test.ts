import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sourceImageProof} from '../scripts/platform-image-metadata.mjs';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'lifeos-synthetic-image-proof-'));
 for(const file of ['package.json','package-lock.json','next.config.ts','Dockerfile.platform-review'])writeFileSync(join(root,file),'synthetic build input\n');
 for(const dir of ['app','src','scripts'])mkdirSync(join(root,dir));
 return{root,close:()=>rmSync(root,{recursive:true,force:true})};
}
test('image proof refuses a context missing the existing root request boundary',()=>{
 const f=fixture();try{assert.throws(()=>sourceImageProof(f.root,'a'.repeat(40)),/Missing required build input/);}finally{f.close();}
});
test('image proof binds the exact proxy bytes and still rejects private root build input',()=>{
 const f=fixture();try{writeFileSync(join(f.root,'proxy.ts'),'synthetic request boundary one\n');const before=sourceImageProof(f.root,'a'.repeat(40));writeFileSync(join(f.root,'proxy.ts'),'synthetic request boundary two\n');const after=sourceImageProof(f.root,'a'.repeat(40));assert.notEqual(before.sourceTreeDigest,after.sourceTreeDigest);assert.notEqual(before.files.find((row:{path:string})=>row.path==='proxy.ts').sha256,after.files.find((row:{path:string})=>row.path==='proxy.ts').sha256);writeFileSync(join(f.root,'.env'),'synthetic forbidden input');assert.throws(()=>sourceImageProof(f.root,'a'.repeat(40)),/Private build input is forbidden/);}finally{f.close();}
});
