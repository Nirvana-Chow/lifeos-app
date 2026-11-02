// Only loaded explicitly by the synthetic subprocess test, never production.
import fs from 'node:fs';
import {registerHooks,syncBuiltinESMExports} from 'node:module';
const runtime=process.env.FIXTURE_RUNTIME_PATH,gate=process.env.FIXTURE_GATE_PATH,fault=process.env.FIXTURE_STARTUP_FAULT;
if(!runtime||!gate)throw Error('Synthetic fixture paths required');
const path=p=>p==='/run/lifeos-platform/runtime.json'?runtime:p==='/run/lifeos-platform/write-gate'?gate:p==='/run/lifeos-platform/write-gate/startup-proof.json'?gate+'/startup-proof.json':p;
const originalOpen=fs.openSync,originalStat=fs.lstatSync,originalRead=fs.readSync,originalParse=JSON.parse;
let runtimeFd,proofFd,replaced=false;
fs.openSync=(p,...rest)=>{const fd=originalOpen(path(p),...rest);if(p==='/run/lifeos-platform/runtime.json')runtimeFd=fd;if(p==='/run/lifeos-platform/write-gate/startup-proof.json')proofFd=fd;return fd;};
fs.lstatSync=(p,...rest)=>originalStat(path(p),...rest);
fs.readSync=(fd,...rest)=>{
 if(fault==='proof-read-error'&&fd===proofFd)throw Error('SYNTHETIC_PRIVATE_PROOF_ERROR');
 if(fault==='runtime-read-error'&&fd===runtimeFd)throw Error('SYNTHETIC_PRIVATE_READ_ERROR');
 const result=originalRead(fd,...rest);
 if(fault==='proof-replaced'&&fd===proofFd&&!replaced){replaced=true;fs.renameSync(gate+'/startup-proof.json',gate+'/previous.json');fs.writeFileSync(gate+'/startup-proof.json','{}',{mode:0o600});}
 return result;
};
JSON.parse=(raw,...rest)=>{
 const value=originalParse(raw,...rest);
 if(fault==='same-bytes'&&!replaced&&typeof raw==='string'&&raw.includes('LIFEOS_PLATFORM_SECRET')){replaced=true;fs.renameSync(runtime,runtime+'.previous');fs.writeFileSync(runtime,JSON.stringify({...value,LIFEOS_PLATFORM_SECRET:'REPLACEMENT_PRIVATE_00000000000000000000'}),{mode:0o600});}
 return value;
};
syncBuiltinESMExports();
registerHooks({resolve(specifier,context,next){
 if(specifier==='pg'||specifier==='better-auth'||specifier.endsWith('/platform/runtime.ts')){console.log('FIXTURE_DB_AUTH_IMPORT');throw Error('Synthetic DB/auth initialization forbidden');}
 if(specifier.endsWith('/.next/standalone/server.js'))return{shortCircuit:true,url:'data:text/javascript,'+encodeURIComponent("if(process.env.LIFEOS_PLATFORM_SECRET!=='SYNTHETIC_PRIVATE_startup_secret_000000000')throw Error('Fixture snapshot changed');if(process.env.LIFEOS_CHAT_CANDIDATE||process.env.LIFEOS_AI_ENABLED)console.log('FIXTURE_INHERITED_CAPABILITY');console.log('FIXTURE_SERVICE_IMPORT_SAME_BYTES');")};
 return next(specifier,context);
}});
