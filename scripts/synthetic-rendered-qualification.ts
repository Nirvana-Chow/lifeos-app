// Finite synthetic image evidence only; never serialize sessions or owner records.
import {readFileSync,writeFileSync,lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const deny=()=>Error('SYNTHETIC_CAPTURE_DENIED');
const origin='https://review.example.test';
export function assertFixtureCompletion(signal:AbortSignal){if(signal.aborted)throw Error('BROWSER_FIXTURE_TIMED_OUT');}
const privateFamilies=[['private-home','/personal'],['private-projects','/personal?page=projects'],['private-areas','/personal?page=areas'],['private-journal','/personal/edit?type=journal'],['private-finance','/personal/finance'],['private-health','/personal/health'],['private-workflows','/personal/workflows'],['private-tools','/personal/tools'],['private-data','/personal/settings/data'],['private-chat','/personal/chat'],['private-settings','/personal?page=settings&panel=general'],['private-outputs-dialog','/personal/outputs']] as const;
const sizes=[1365,360,390,430] as const,themes=['light','dark'] as const;
export const expectedSyntheticCaptures=Object.freeze([
 ...(['recovery','login','mfa-login'] as const).flatMap(kind=>(['desktop','mobile'] as const).map(size=>({name:kind+'-'+size+'.png',directory:'owner-recovery-browser-screenshots',route:kind==='recovery'?'/account/recover':kind==='login'?'/':'/login',width:size==='desktop'?1365:390,height:size==='desktop'?900:844,theme:size==='desktop'?'light':'dark'}))),
 ...(['workspace','editor'] as const).flatMap(kind=>sizes.flatMap(width=>themes.map(theme=>({name:`${kind}-${width}-${theme}.png`,directory:'owner-personal-browser-screenshots',route:kind==='workspace'?'/personal?page=tasks':'/personal/edit?type=todo&id=',width,height:width===1365?900:844,theme})))),
 ...privateFamilies.flatMap(([key,route])=>sizes.flatMap(width=>themes.map(theme=>({name:`${key}-${width}-${theme}.png`,directory:'owner-personal-browser-screenshots',route,width,height:width===1365?900:844,theme})))),
].map(row=>Object.freeze(row)));
export type SyntheticCaptureInput={name:string;url:string;width:number;height:number;theme:string};
export function captureDescriptor(value:SyntheticCaptureInput){
 const row=expectedSyntheticCaptures.find(row=>row.name===value.name);if(!row||row.width!==value.width||row.height!==value.height||row.theme!==value.theme)throw deny();
 let url:URL;try{url=new URL(value.url);}catch{throw deny();}
 if(url.origin!==origin||url.username||url.password||url.hash||url.href!==origin+url.pathname+url.search)throw deny();
 const route=url.pathname+url.search;
 if(row.name.startsWith('editor-')?!new RegExp('^/personal/edit\\?type=todo&id=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$').test(route):route!==row.route)throw deny();
 return {name:row.name,directory:row.directory,route,viewport:{width:row.width,height:row.height},theme:row.theme};
}
export function qualificationIdentity(env:Record<string,string|undefined>,sourceSha:string,buildId:string){
 if(env.GITHUB_REPOSITORY!=='Nirvana-Chow/lifeos-app'||env.GITHUB_REPOSITORY_ID!=='1443243170'||!/^[0-9a-f]{40}$/.test(sourceSha)||sourceSha!==env.SOURCE_SHA||sourceSha!==env.CI_HEAD_SHA||!/^\d{1,20}$/.test(env.GITHUB_RUN_ID??'')||!/^\d{1,4}$/.test(env.GITHUB_RUN_ATTEMPT??'')||!/^[A-Za-z0-9_-]{1,100}$/.test(buildId))throw deny();
 return {repository:'Nirvana-Chow/lifeos-app',repositoryId:'1443243170',sourceSha,runId:env.GITHUB_RUN_ID!,runAttempt:env.GITHUB_RUN_ATTEMPT!,buildId};
}
function requireRunner(){if(process.platform!=='linux'||process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||process.env.LIFEOS_FIXTURE_FRESH!=='approved-isolated-fixture'||!process.env.RUNNER_TEMP)throw deny();return resolve(process.env.RUNNER_TEMP);}
const captures=new Map<string,ReturnType<typeof captureDescriptor>&{sha256:string;bytes:number;image:{width:number;height:number}}>();
export function recordSyntheticCapture(value:SyntheticCaptureInput){
 const root=requireRunner(),descriptor=captureDescriptor(value);if(captures.has(descriptor.name))throw deny();
 const directory=join(root,descriptor.directory),path=join(directory,descriptor.name);if(lstatSync(directory).isSymbolicLink()||!lstatSync(directory).isDirectory())throw deny();
 const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<100||stat.size>20_000_000)throw deny();
 const data=readFileSync(path);if(!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||data.toString('ascii',12,16)!=='IHDR')throw deny();
 const width=data.readUInt32BE(16),height=data.readUInt32BE(20);if(width!==descriptor.viewport.width||height<1||height>20000)throw deny();
 captures.set(descriptor.name,{...descriptor,sha256:createHash('sha256').update(data).digest('hex'),bytes:data.length,image:{width,height}});
}
/** Called only after all five cases' assertions and browser/NSS cleanup succeeded. */
export function publishSyntheticCaptureManifest(signal:AbortSignal){
 assertFixtureCompletion(signal);
 const root=requireRunner(),proof=JSON.parse(readFileSync('.image-source-proof.json','utf8')),buildId=readFileSync('.next/BUILD_ID','utf8').trim(),identity=qualificationIdentity(process.env,proof.sourceSha,buildId);
 if(captures.size!==expectedSyntheticCaptures.length||expectedSyntheticCaptures.some(row=>!captures.has(row.name)))throw deny();
 let total=0;const images=expectedSyntheticCaptures.map(row=>{const value=captures.get(row.name)!;const data=readFileSync(join(root,value.directory,value.name));if(createHash('sha256').update(data).digest('hex')!==value.sha256)throw deny();total+=data.length;return value;});if(total>200_000_000)throw deny();
 const manifest={version:1,kind:'synthetic-rendered-qualification',...identity,captureGuard:'finite-source-and-synthetic-content-v1',images};
 writeFileSync(join(root,'synthetic-rendered-qualification.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});captures.clear();
}
