// Packaged as root/worker-bridge-entry.mjs and pinned by the original native
// host. Only built-ins load before the reviewed closed-world code gate.
import {lstatSync,realpathSync,openSync,fstatSync,readFileSync,closeSync,constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function bytes(path,privateFile=false,limit=8*1024*1024){
 if(typeof path!=='string'||!isAbsolute(path)||realpathSync(path)!==path)throw Error();
 const s=lstatSync(path);if(!s.isFile()||s.uid!==process.getuid()||s.nlink!==1||(s.mode&(privateFile?0o077:0o6022))||s.size>limit)throw Error();
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const f=fstatSync(fd);if(f.ino!==s.ino||f.dev!==s.dev)throw Error();return readFileSync(fd);}finally{closeSync(fd);}
}
try{
 const [major,minor]=process.versions.node.split('.').map(Number);
 // The root/native host pins the actual Node executable and argv. Source/CI
 // supports the repository's >=24.18 <25 engine, not one private-client minor.
 if(process.argv.length!==4||process.execArgv.length||process.env.NODE_OPTIONS||process.env.NODE_PATH||major!==24||!Number.isInteger(minor)||minor<18)throw Error();
 const [bindingPath,expected]=process.argv.slice(2);if(!/^[a-f0-9]{64}$/.test(expected))throw Error();
 const raw=bytes(bindingPath,true,8192);if(digest(raw)!==expected)throw Error();
 const binding=JSON.parse(raw.toString('utf8')),root=binding.root;
 if(typeof root!=='string'||!isAbsolute(root)||realpathSync(root)!==root||fileURLToPath(import.meta.url)!==join(root,'worker-bridge-entry.mjs'))throw Error();
 const st=lstatSync(root);if(!st.isDirectory()||st.uid!==process.getuid()||(st.mode&0o077))throw Error();
 if(binding.gate?.binary!==join(root,'code-guard.mjs')||!/^[a-f0-9]{64}$/.test(binding.gate.sha256)||!/^[a-f0-9]{64}$/.test(binding.manifestSHA256))throw Error();
 if(digest(bytes(binding.gate.binary))!==binding.gate.sha256)throw Error();
 const {establishCodeBoundary}=await import(pathToFileURL(binding.gate.binary).href);
 establishCodeBoundary(root,binding.manifestSHA256);
 const {serveAdoptedWorkerBridge}=await import(pathToFileURL(join(root,'public/src/worker-host-adoption/bridge.ts')).href);
 await serveAdoptedWorkerBridge(binding);
}catch{process.stderr.write('WORKER_BRIDGE_REJECTED\n');process.exitCode=78;}
