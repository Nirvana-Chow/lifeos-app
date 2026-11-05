import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,expect,type Browser,type BrowserServer} from '@playwright/test';
import {readyHeading,assertPrivateCaptureContent,captureSourceText,privateLocalInteractions,privateMobileNavigation} from './helpers/private-business-browser-fixture.ts';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';

test('OPT-IN private visual oracle admits only native closed finance and health surfaces',{
 skip:process.env.RUN_PRIVATE_NATIVE_VISUAL_BROWSER_TESTS!=='1'&&'Requires disposable read-only Next/Chrome fixture',timeout:120000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-private-visual-'));
 let browser:Browser|undefined,browserServer:BrowserServer|undefined,browserProcess:FixtureProcess|undefined,server:FixtureProcess|undefined;
 t.after(()=>cleanupAuthThemeFixture({root,browser,browserServer,browserProcess,server}));
 await mkdir(join(root,'app','[[...section]]'),{recursive:true});
 await Promise.all([cp(join(source,'src'),join(root,'src'),{recursive:true}),...['layout.tsx','globals.css','theme.css'].map(name=>cp(join(source,'app',name),join(root,'app',name))),cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components'))]);
 await writeFile(join(root,'app','[[...section]]','page.tsx'),`'use client';
import {usePathname} from 'next/navigation';
import {LifeOSWorkspace} from '../../src/ui-review/workspace';
import {PersonalRecordPage} from '../../src/personal-candidate/record-page';
import {PersonalCalendarPage} from '../../src/calendar-candidate/personal-page';
import {PersonalFinancePage} from '../../src/personal-finance/page';
export default function Page(){const path=usePathname();if(path.endsWith('/health'))return <PersonalRecordPage type="health"/>;if(path.endsWith('/people'))return <PersonalRecordPage type="person"/>;if(path.endsWith('/schedule'))return <PersonalCalendarPage/>;if(path.endsWith('/finance'))return <PersonalFinancePage/>;return <LifeOSWorkspace state={{status:'ready',data:{tasks:[],projects:[],areas:[],topics:[],today:'2030-11-05',asOf:'2030-11-05T00:00:00Z',coverage:'complete'}}} access={{authenticated:true,writable:true,loginAllowed:true,allowedTypes:['todo','journal','project','domain','topic']}} onCreateTask={()=>true} viewPreferenceScope={JSON.stringify(['personal-review-user','personal-review-space'])}/>;}`);
 const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,detached:true,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});server=trackAuthThemeProcess(child,true);
 let output='';const collect=(chunk:Buffer)=>{output=(output+String(chunk)).slice(-3000);};child.stdout.on('data',collect);child.stderr.on('data',collect);
 const origin=await new Promise<string>((accept,reject)=>{const timer=setTimeout(()=>reject(Error('fixture-start-timeout')),30000);const check=()=>{const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);child.stdout.off('data',check);accept(match[0]);}};child.stdout.on('data',check);child.once('exit',()=>{clearTimeout(timer);reject(Error('fixture-start-exit'));});check();});
 browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});browserProcess=trackAuthThemeProcess(browserServer.process());browser=await chromium.connect(browserServer.wsEndpoint());
 for(const [width,theme] of [1365,360,390,430].flatMap(width=>(['light','dark'] as const).map(theme=>[width,theme] as const))){
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme}),requests:string[]=[],errors:string[]=[];
  page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/platform/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;requests.push(request.method()+' '+path);
   if(request.method()!=='GET')return route.abort();
   const body=path==='/api/platform/personal/status'?{scope:'personal-manual-candidate',ownerId:'personal-review-user',spaceId:'personal-review-space',storageVerified:true,writable:true,allowedTypes:['todo','journal','project','domain','topic']}:path==='/api/platform/personal/finance/status'?{scope:'personal-finance-v1',configured:false,writable:false}:path==='/api/platform/personal/calendar/status'?{scope:'personal-calendar-v1',configured:false,writable:false}:null;
   if(!body)return route.abort();
   await route.fulfill({status:200,headers:{'cache-control':'private, no-store'},json:body});
  });
  for(const [path,heading] of [['health','健康'],['finance','财务']] as const){
   await page.goto(origin+'/personal/'+path,{waitUntil:'domcontentloaded',timeout:60000});await readyHeading(page,heading);
   await privateLocalInteractions(page,'private-'+path);
   const facts=await page.locator('.lo-shell').evaluate(shell=>{
    const texts:string[]=[],walk=document.createTreeWalker(shell,NodeFilter.SHOW_TEXT);let node:Node|null;
    while((node=walk.nextNode())){const parent=node.parentElement;if(!parent||parent.closest('script,style,noscript,option'))continue;const range=document.createRange();range.selectNode(node);if(!Array.from(range.getClientRects()).some(r=>r.width>0&&r.height>0))continue;const text=node.textContent?.replace(/\s+/g,' ').trim();if(text)texts.push(text);}
    return {forbidden:shell.querySelectorAll('input[type="password"],input[name="otp"],input[autocomplete="one-time-code"],input[autocomplete="username"],input[autocomplete="current-password"],input[autocomplete="new-password"],#mfa-setup-key,canvas[aria-label="验证器绑定二维码"],[aria-label="备用恢复码"]').length,texts,values:Array.from(shell.querySelectorAll<HTMLInputElement>('input,textarea,select')).map(n=>n.value),editable:Array.from(shell.querySelectorAll('[contenteditable]:not([contenteditable="false"])')).map(n=>n.textContent??''),recordIds:Array.from(shell.querySelectorAll('[data-record-id]')).map(n=>n.getAttribute('data-record-id')??'')};
   });
   assertPrivateCaptureContent(facts,captureSourceText(),new Set(['']),[]);
   assert.throws(()=>assertPrivateCaptureContent({...facts,texts:[...facts.texts,'private body from unapproved source']},captureSourceText(),new Set(['']),[]),/PRIVATE_CAPTURE_DENIED/);
   if(width<800&&path==='finance')await privateMobileNavigation(page);
  }
  assert.deepEqual(errors,[]);assert.ok(requests.length>0);assert.ok(requests.every(value=>value.startsWith('GET ')));
  assert.ok(requests.every(value=>value.endsWith('/status')),'closed surfaces must not request business snapshots');
  console.log('PRIVATE_NATIVE_VISUAL '+JSON.stringify({width,theme,surfaces:2,readOnly:true}));await page.close();
 }
});
