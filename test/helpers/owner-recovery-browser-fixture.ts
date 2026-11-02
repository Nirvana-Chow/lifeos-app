import {execFileSync,spawnSync} from 'node:child_process';
import {constants,existsSync,lstatSync,fstatSync,openSync,closeSync,mkdirSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {request} from 'node:https';
import {fileURLToPath} from 'node:url';
import type {Page,Browser} from '@playwright/test';
import {fixtureLookup,fixtureErrorCode} from './owner-recovery-https-config.ts';
import {themeInitializationScript} from '../../src/workbench/theme.ts';

/** Two normal public documents in a fresh context; no routing or cache-setting interception. */
export async function assertPublicStaticCache(browser:Browser):Promise<void>{
 const context=await browser.newContext(),page=await context.newPage();let session:Awaited<ReturnType<typeof context.newCDPSession>>|undefined;
 const fail=()=>Error('STATIC_CACHE_BROWSER_UNVERIFIED');
 try{
  const first=await page.goto('https://review.example.test/login',{waitUntil:'load'});if(first?.status()!==200||first.request().resourceType()!=='document')throw fail();
  await page.waitForFunction(()=>{const button=document.querySelector('form[action="/login"] button');return !!button&&!button.matches(':disabled');});
  const asset=await page.evaluate(()=>{for(const row of performance.getEntriesByType('resource') as PerformanceResourceTiming[]){const u=new URL(row.name);if(u.origin===location.origin&&u.pathname.startsWith('/_next/static/')&&u.pathname.endsWith('.js')&&row.encodedBodySize>0)return u.pathname+u.search;}return null;});
  if(!asset)throw fail();session=await context.newCDPSession(page);await session.send('Network.enable');let cdpHit=false;const requests=new Set<string>();
  session.on('Network.requestWillBeSent',(event:{requestId:string;request:{url:string}})=>{try{const u=new URL(event.request.url);if(u.origin==='https://review.example.test'&&u.pathname+u.search===asset&&requests.size<1000)requests.add(event.requestId);}catch{}});
  session.on('Network.requestServedFromCache',(event:{requestId:string})=>{if(requests.has(event.requestId))cdpHit=true;});
  session.on('Network.responseReceived',(event:{requestId:string;response:{fromDiskCache?:boolean;fromPrefetchCache?:boolean}})=>{if(requests.has(event.requestId)&&(event.response.fromDiskCache===true||event.response.fromPrefetchCache===true))cdpHit=true;});
  const second=await page.goto('https://review.example.test/',{waitUntil:'load'});if(second?.status()!==200||second.request().resourceType()!=='document')throw fail();
  await page.waitForFunction(()=>{const button=document.querySelector('form[action="/login"] button');return !!button&&!button.matches(':disabled');});
  const timing=await page.evaluate(path=>{const row=(performance.getEntriesByType('resource') as PerformanceResourceTiming[]).find(e=>{const u=new URL(e.name);return u.origin===location.origin&&u.pathname+u.search===path;});return {observed:!!row,cache:!!row&&row.transferSize===0&&row.encodedBodySize>0};},asset);
  if(!timing.observed||!cdpHit&&!timing.cache)throw fail();console.log('STATIC_CACHE_BROWSER '+JSON.stringify({observed:timing.observed,hit:true,cdpHit,resourceTimingHit:timing.cache}));
 }finally{try{await session?.detach();}finally{await context.close();}}
}

/** Existing public filing metadata only; geometry checks never return page/field content. */
export async function assertPublicLayout(page:Page,{expectFits=false,expectScroll=false}:{expectFits?:boolean;expectScroll?:boolean}={}):Promise<void>{
 const facts=await page.evaluate(()=>({main:!!document.querySelector('main'),noOverflow:document.documentElement.scrollWidth<=document.documentElement.clientWidth,fits:document.documentElement.scrollHeight<=innerHeight+2,scrolls:document.documentElement.scrollHeight>innerHeight+2,ownerFooter:!!document.querySelector('.lifeos-filing-footer')}));
 if(!facts.main||!facts.noOverflow||facts.ownerFooter||expectFits&&!facts.fits||expectScroll&&!facts.scrolls)throw Error('Public layout unavailable or unexpectedly includes an owner-specific footer');
}

export async function applyAuthFixtureAppearance(page:Pick<Page,'emulateMedia'|'addScriptTag'>,theme:'light'|'dark'):Promise<void>{
 await page.emulateMedia({colorScheme:theme});
 // Auth pages initialize their custom tokens in the head, rather than mounting
 // the workspace's live system-theme listener. Reproduce a fresh theme here.
 await page.addScriptTag({content:themeInitializationScript});
}

const allowedScreenshots=new Set(['recovery-desktop.png','recovery-mobile.png','login-desktop.png','login-mobile.png','mfa-login-desktop.png','mfa-login-mobile.png']);
export async function safeScreenshot(page:Pick<Page,'locator'|'screenshot'>,name:string):Promise<void>{
 if(!allowedScreenshots.has(name)||!process.env.RUNNER_TEMP)throw Error('SCREENSHOT_DENIED');
 const empty=await page.locator('input,textarea,#mfa-setup-key,canvas[aria-label="验证器绑定二维码"],[aria-label="备用恢复码"]').evaluateAll(nodes=>nodes.every(node=>{if(!['INPUT','TEXTAREA'].includes(node.tagName))return false;const input=node as HTMLInputElement;return input.name==='username'||input.name==='email'?input.value===''||input.value==='owner':input.value==='';}));
 if(!empty)throw Error('SCREENSHOT_DENIED');
 const dir=resolve(process.env.RUNNER_TEMP,'owner-recovery-browser-screenshots');mkdirSync(dir,{recursive:true,mode:0o700});await page.screenshot({path:join(dir,name),fullPage:true});
}
function assertFixture(){if(process.platform!=='linux'||process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||process.env.LIFEOS_FIXTURE_FRESH!=='approved-isolated-fixture'||!process.env.RUNNER_TEMP)throw Error('BROWSER_FIXTURE_UNAVAILABLE');}
const dbPaths=()=>[join(homedir(),'.pki','nssdb'),join(homedir(),'.local','share','pki','nssdb')];
const metadataPath=()=>join(process.env.RUNNER_TEMP!,'owner-recovery-browser-nss.json');
type Receipt={version:1;db:string;nickname:string};
function validateReceipt(value:unknown):Receipt{const r=value as Receipt;if(!r||typeof r!=='object'||Object.keys(r).sort().join(',')!=='db,nickname,version'||r.version!==1||!dbPaths().includes(r.db)||typeof r.nickname!=='string'||!/^lifeos-fixture-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(r.nickname))throw Error('NSS_FIXTURE_UNAVAILABLE');return r;}
function run(args:string[]):Buffer{return execFileSync('certutil',args,{stdio:['ignore','pipe','pipe'],timeout:10000,maxBuffer:1024*1024});}
/** A successful full listing is required alongside any absent-nickname response. */
export function classifyNssLookup(status:number,stderr:string,listed:boolean):boolean{
 if(status===0){if(!listed)throw Error('NSS_CHECK_FAILED');return true;}
 if(!/\b(?:SEC_ERROR_UNKNOWN_CERT|PR_FILE_NOT_FOUND_ERROR)\b/.test(stderr)||listed)throw Error('NSS_CHECK_FAILED');return false;
}
/** A nonzero nickname lookup alone is ambiguous; require a readable full listing too. */
function nicknamePresent(receipt:Receipt):boolean{
 const db='sql:'+receipt.db,probe=spawnSync('certutil',['-L','-d',db,'-n',receipt.nickname],{stdio:['ignore','pipe','pipe'],timeout:10000,encoding:'utf8',maxBuffer:1024*1024});
 if(probe.error||probe.signal||probe.status===null)throw Error('NSS_CHECK_FAILED');
 const listing=run(['-L','-d',db]).toString('utf8');const listed=listing.split('\n').some(line=>line.trimStart().split(/\s+/)[0]===receipt.nickname);
 return classifyNssLookup(probe.status,probe.stderr,listed);
}
/** Remove only the UUID-scoped nickname recorded by this fixture and verify absence. */
export function cleanupFixtureCA():void{
 assertFixture();const file=metadataPath();let st:ReturnType<typeof lstatSync>;try{st=lstatSync(file);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw Error('NSS_FIXTURE_UNAVAILABLE');}if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o777)!==0o600||st.nlink!==1||st.size>2048)throw Error('NSS_FIXTURE_UNAVAILABLE');
 const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);let raw:string;try{const actual=fstatSync(fd);if(actual.dev!==st.dev||actual.ino!==st.ino||actual.size!==st.size)throw Error('NSS_FIXTURE_UNAVAILABLE');raw=readFileSync(fd,'utf8');}finally{closeSync(fd);}const receipt=validateReceipt(JSON.parse(raw));if(nicknamePresent(receipt))run(['-D','-d','sql:'+receipt.db,'-n',receipt.nickname]);if(nicknamePresent(receipt))throw Error('NSS_CLEANUP_FAILED');unlinkSync(file);
}
export function trustFixtureCA(certificate:string):()=>void{
 assertFixture();if(certificate!==join(process.env.RUNNER_TEMP!,'recovery-tls','ca.crt'))throw Error('NSS_FIXTURE_UNAVAILABLE');
 const [old,modern]=dbPaths(),dir=existsSync(old)?old:modern,existed=existsSync(dir);if(existed&&!existsSync(join(dir,'cert9.db')))throw Error('NSS_FIXTURE_UNAVAILABLE');
 mkdirSync(dir,{recursive:true,mode:0o700});const receipt:Receipt={version:1,db:dir,nickname:'lifeos-fixture-'+randomUUID()};if(!existed)run(['-N','-d','sql:'+dir,'--empty-password']);
 if(nicknamePresent(receipt))throw Error('NSS_FIXTURE_UNAVAILABLE');writeFileSync(metadataPath(),JSON.stringify(receipt),{mode:0o600,flag:'wx'});
 try{run(['-A','-d','sql:'+dir,'-t','C,,','-n',receipt.nickname,'-i',certificate]);if(!nicknamePresent(receipt))throw Error('NSS_FIXTURE_UNAVAILABLE');}catch{cleanupFixtureCA();throw Error('NSS_FIXTURE_UNAVAILABLE');}
 return cleanupFixtureCA;
}
/** HTTPS readiness uses the fixture CA and fixed SNI/Host; the entire response is consumed. */
export async function waitBrowserFixture():Promise<void>{
 assertFixture();const ca=readFileSync(join(process.env.RUNNER_TEMP!,'recovery-tls','ca.crt'));let last='NOT_ATTEMPTED';
 for(let i=0;i<40;i++){const ok=await new Promise<boolean>(resolve=>{const req=request('https://review.example.test/login',{port:443,servername:'review.example.test',ca,...fixtureLookup,headers:{host:'review.example.test'},timeout:1000},res=>{last='HTTP_'+String(res.statusCode??0);res.on('end',()=>resolve(res.statusCode===200));res.on('error',error=>{last='RESPONSE_'+fixtureErrorCode(error);resolve(false);});res.resume();});req.on('error',error=>{last='TRANSPORT_'+fixtureErrorCode(error);resolve(false);});req.on('timeout',()=>req.destroy(Object.assign(Error('timeout'),{code:'ETIMEDOUT'})));req.end();});if(ok)return;await new Promise(resolve=>setTimeout(resolve,500));}
 throw Error('BROWSER_HTTPS_UNAVAILABLE_'+last);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.slice(2).join(' ')==='wait-https')await waitBrowserFixture();else if(process.argv.slice(2).join(' ')==='cleanup-nss')cleanupFixtureCA();else throw Error();}catch(error){const message=error instanceof Error?error.message:'';console.error(/^BROWSER_HTTPS_UNAVAILABLE_(?:HTTP_[0-9]+|(?:TRANSPORT|RESPONSE)_[A-Z0-9_]+)$/.test(message)?message:'BROWSER_FIXTURE_FAILED');process.exitCode=1;}
}
