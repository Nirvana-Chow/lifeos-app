import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {on} from 'node:events';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,expect,type Browser,type BrowserServer,type Page} from '@playwright/test';
import {MemoryPort} from './helpers/platform.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import {handlePersonalRequest} from '../src/personal-candidate/http.ts';
import {emptyCareerPersonal} from '../src/personal-career/domain.ts';
import {emptyMediaPersonal} from '../src/personal-media/domain.ts';
import {emptyPortfolioPersonal} from '../src/personal-portfolio/model.ts';

const businessPaths={career:'职业',resume:'简历',media:'书影音',portfolio:'账户资产投资'} as const;
type BusinessPath=keyof typeof businessPaths;
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';

test('OPT-IN the four business records use one authorized shell when explicitly registered',{
 skip:process.env.RUN_BUSINESS_RECORD_HOST_BROWSER_TESTS!=='1'&&'Requires synthetic Next and Chromium',timeout:180_000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'), root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-business-record-host-'));
 let server:FixtureProcess|undefined,browserProcess:FixtureProcess|undefined,browser:Browser|undefined,browserServer:BrowserServer|undefined;
 t.after(()=>cleanupAuthThemeFixture({root,server,browserProcess,browser,browserServer}));
 for(const name of Object.keys(businessPaths))await mkdir(join(root,'app/personal',name),{recursive:true});
 await mkdir(join(root,'app/login'),{recursive:true});
 await Promise.all([
  ...['layout.tsx','globals.css','theme.css','personal/layout.tsx','personal/page.tsx',...Object.keys(businessPaths).map(name=>'personal/'+name+'/page.tsx')].map(file=>cp(join(source,'app',file),join(root,'app',file))),
  cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),cp(join(source,'src'),join(root,'src'),{recursive:true}),
  symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components')),
 ]);
 await writeFile(join(root,'app/login/page.tsx'),'export default function Page(){return <h1>Synthetic login</h1>}');
 await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
 await writeFile(join(root,'src/platform/runtime.ts'),`
 export const readPlatformLoginCapability=async()=>({sessionDuration:true});
 export const readPlatformPasswordCapability=async()=>false;
 export const readPlatformPagePrincipal=async(headers)=>headers.get('cookie')?.includes('synthetic-owner=1')&&!headers.get('cookie')?.includes('synthetic-deny=1')?{id:'synthetic-owner'}:null;
 `);
 const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{
  cwd:root,detached:true,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],
 });
 server=trackAuthThemeProcess(child,true);
 child.stderr.resume();
 let origin='',output='';
 for await(const [chunk] of on(child.stdout,'data',{signal:AbortSignal.timeout(30000)})){
  output=(output+String(chunk)).slice(-4000);
  const match=output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
  if(match&&/Ready in\b/.test(output)){origin=match;break;}
 }
 assert.ok(origin);
 // Compile fixture routes before asserting browser navigation and rendering.
 for(const route of Object.keys(businessPaths)){
  const response=await fetch(origin+'/personal/'+route,{headers:{cookie:'synthetic-owner=1'},signal:AbortSignal.timeout(90_000)});
  assert.equal(response.status,200);
  await response.arrayBuffer();
 }
 browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
 browserProcess=trackAuthThemeProcess(browserServer.process());
 browser=await chromium.connect(browserServer.wsEndpoint());
 const config={ownerId:'synthetic-owner',ownerEmail:'fixture@example.invalid',spaceId:'synthetic-business-space',
  databaseName:'lifeos_platform_test_local',baseURL:origin,approval:'personal-manual-v1',
  allowedTypes:['todo','journal','project','domain','topic'],careerEnabled:true,mediaEnabled:true,portfolioEnabled:true} as const;
 const repository=new MemoryPort();
 repository.readCurrentSnapshot=async owner=>[...repository.rows.values()].filter(row=>row.ownerId===owner);
 const service=new PersonalService(repository,config);
 const seed=(type:'career'|'media'|'portfolio',title:string,personal:unknown,key:string)=>service.mutate(
  config.ownerId,type,null,{spaceId:config.spaceId,confirmed:true,fields:{title,text:'Synthetic record body',occurredOn:null,personal}},'business-host-fixture-'+key);
 for(let index=0;index<48;index++)await seed('career','Synthetic opportunity '+index,emptyCareerPersonal('opportunity'),'career-'+index);
 const resume=(await seed('career','Synthetic resume',emptyCareerPersonal('resume'),'resume')).entry;
 const media=(await seed('media','Synthetic film',emptyMediaPersonal('film'),'media')).entry;
 await seed('portfolio','Synthetic account',emptyPortfolioPersonal('account'),'portfolio');

 for(const width of [1365,390,430]){
  const page:Page=await browser.newPage({viewport:{width,height:850}});
  const writes:string[]=[],documents:string[]=[],errors:string[]=[],reads:string[]=[];
  const mediaRead=Promise.withResolvers<void>(),mediaRequested=Promise.withResolvers<void>();
  let holdMediaRead=false;
  let writable=true;
  await page.context().addCookies([{name:'synthetic-owner',value:'1',url:origin}]);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.resourceType()==='document')documents.push(new URL(request.url()).pathname);});
  await page.route('**/api/platform/**',async route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname;
   if(url.origin!==origin)return route.abort();
   if(request.method()!=='GET'){writes.push(path);return route.fulfill({status:405,json:{}});}
   reads.push(path);
   if(path.endsWith('/availability'))return route.fulfill({json:{configured:true,loginAllowed:true,transport:'ssh-loopback',origin}});
   if(path.endsWith('/auth/get-session'))return route.fulfill({json:{user:{id:config.ownerId},session:{
    mfaVerified:true,sessionDurationMode:'fixed',sessionDurationSeconds:1800,expiresAt:new Date(Date.now()+600000).toISOString()}}});
   const access={...config,scope:'personal-manual-candidate',storageVerified:true,writable};
   if(path.endsWith('/status'))return route.fulfill({json:access});
   if(path.endsWith('/todo/workspace-snapshot'))return route.fulfill({json:{scope:'task-workspace-current-snapshot',access,
    items:[],truncated:false,total:0,today:url.searchParams.get('today'),observedAt:'2030-11-01T00:00:00.000Z'}});
   if(holdMediaRead&&path==='/api/platform/personal/media/snapshot'){
    mediaRequested.resolve();
    await mediaRead.promise;
   }
   const response=await handlePersonalRequest(new Request(url,{headers:{host:url.host}}),config.ownerId,origin,service,{
    assertOwner:async()=>{},assertWritable:async()=>{throw Error('Fixture is read-only');},
   });
   return response?route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()}):
    route.fulfill({status:404,json:{}});
  });
  const main=page.locator('#personal-main');
  const heading=(name:BusinessPath)=>main.getByRole('heading',{name:businessPaths[name],exact:true,level:1});
  const search=(name:BusinessPath)=>main.getByRole('textbox',{name:'搜索'+businessPaths[name],exact:true});
  const nodeSelectors=['.lo-shell','header.lo-header','aside.lo-sidebar','#personal-main'];
  await page.goto(origin+'/personal/career',{waitUntil:'domcontentloaded',timeout:60000});
  await expect(heading('career')).toBeVisible({timeout:30000});
  await expect(main.getByRole('button',{name:'求职看板',exact:true})).toBeEnabled();
  await expect(main.getByRole('button',{name:/^Synthetic opportunity /}).first()).toBeVisible();
  await page.evaluate(selectors=>Object.assign(window,{businessShell:{document,nodes:selectors.map(s=>document.querySelector(s))}}),nodeSelectors);
  const sameShell=():Promise<boolean>=>page.evaluate(selectors=>{
   const previous=(window as Window&{businessShell?:{document:Document;nodes:(Node|null)[]}}).businessShell;
   return previous?.document===document&&selectors.every((s,i)=>previous.nodes[i]===document.querySelector(s));
  },nodeSelectors);
  async function go(name:BusinessPath){
   const mobile=page.getByRole('button',{name:'打开导航',exact:true});
   if(width!==1365)await mobile.click();
   const header=page.locator('header.lo-header');
   const nav=width!==1365?page.getByRole('dialog',{name:'LifeOS',exact:true}):header;
   if(name==='portfolio'){
    const finance=nav.getByRole('link',{name:'财务',exact:true});
    await finance.click();
   }else{
    const tab=nav.getByRole('button',{name:name==='media'?'兴趣学习':'职业成长',exact:true});
    if(await tab.isVisible())await tab.click();
    const sidebar=width!==1365?nav:page.locator('aside.lo-sidebar');
    await sidebar.getByRole('link',{name:businessPaths[name],exact:true}).click();
   }
   await expect(page).toHaveURL(origin+'/personal/'+name);
   await expect(heading(name)).toBeVisible();
   assert.equal(await sameShell(),true);
  }
  await search('career').fill('Synthetic opportunity');
  // Exercise the existing horizontal scrollbar at both screen sizes.
  await page.addStyleTag({content:'[data-personal-record-module="career"] [data-slot="data-grid-table"]{min-width:1400px!important}'});
  const viewport=main.locator('[data-slot="data-grid-table-viewport"]');
  const position=()=>viewport.evaluate(node=>({x:node.scrollLeft,y:node.scrollTop}));
  await viewport.evaluate(node=>node.scrollTo(72,180));
  await expect.poll(position).toEqual({x:72,y:180});
  await go('resume');
  await expect(search('resume')).toHaveValue('');
  await main.getByRole('combobox',{name:'简历版本'}).selectOption(resume.id);
  await expect(main.getByRole('region',{name:'简历预览'}).getByText('Synthetic resume',{exact:true})).toBeVisible();
  await expect(main.getByRole('button',{name:'打印此简历'})).toBeVisible();
  await page.evaluate(()=>{setTimeout(()=>history.back(),0);});
  await expect(page).toHaveURL(origin+'/personal/career');
  await expect(heading('career')).toBeVisible();
  assert.equal(await sameShell(),true);
  const focus=width!==1365?page.getByRole('button',{name:'打开导航',exact:true}):
   page.locator('aside.lo-sidebar').getByRole('link',{name:'简历',exact:true});
  await expect(focus).toBeFocused();
  await viewport.waitFor();
  await expect.poll(position).toEqual({x:72,y:180});
  const scrollRestored=await position();
  await expect(search('career')).toHaveValue('');
  await page.evaluate(()=>{setTimeout(()=>history.forward(),0);});
  await expect(page).toHaveURL(origin+'/personal/resume');
  await expect(heading('resume')).toBeVisible();
  assert.equal(await sameShell(),true);
  await go('media');
  await expect(search('media')).toHaveValue('');
  await expect(main.getByRole('region',{name:'阅读与观影书架'}).getByText('电影',{exact:true})).toBeVisible();
  await go('portfolio');
  await expect(search('portfolio')).toHaveValue('');
  await expect(main.getByText('Synthetic account',{exact:true})).toBeVisible();
  holdMediaRead=true;
  try{
   await page.evaluate(()=>{setTimeout(()=>history.back(),0);});
   await expect(page).toHaveURL(origin+'/personal/media');
   await expect(heading('media')).toBeVisible();
   await mediaRequested.promise;
   assert.equal(await sameShell(),true);
   await page.evaluate(()=>{setTimeout(()=>history.forward(),0);});
   await expect(page).toHaveURL(origin+'/personal/portfolio');
   await expect(heading('portfolio')).toBeVisible();
  }finally{
   holdMediaRead=false;
   mediaRead.resolve();
  }
  assert.equal(await sameShell(),true);
  await page.evaluate(()=>{setTimeout(()=>history.back(),0);});
  assert.equal(await sameShell(),true);
  await expect(page).toHaveURL(origin+'/personal/media');
  await expect(heading('media')).toBeVisible();
  await main.getByRole('button',{name:'表格',exact:true}).click();
  await main.getByRole('button',{name:'Synthetic film',exact:true}).click();
  const detail=page.getByRole('dialog',{name:'编辑书影音'});
  await expect(detail.getByRole('textbox',{name:'标题',exact:true})).toHaveValue('Synthetic film');
  assert.ok(reads.includes('/api/platform/personal/media/'+media.id));
  assert.ok(reads.includes('/api/platform/personal/media/'+media.id+'/history'));
  await detail.getByRole('textbox',{name:'标题',exact:true}).fill('Synthetic unsaved film');
  const confirmation=page.waitForEvent('dialog');
  await page.evaluate(()=>{setTimeout(()=>history.back(),0);});
  await (await confirmation).dismiss();
  await expect(page).toHaveURL(origin+'/personal/media');
  await expect(detail.getByRole('textbox',{name:'标题',exact:true})).toHaveValue('Synthetic unsaved film');
  const discard=page.waitForEvent('dialog');
  await page.evaluate(()=>{setTimeout(()=>history.back(),0);});
  await (await discard).accept();
  await expect(page).toHaveURL(origin+'/personal/resume');
  await expect(heading('resume')).toBeVisible();
  await expect(detail).toHaveCount(0);
  assert.equal(await sameShell(),true);
  assert.deepEqual(documents,['/personal/career']);
  assert.deepEqual(writes,[]);
  assert.deepEqual(errors,[]);
  console.log('BUSINESS_HOST_ROUTES '+JSON.stringify({width,documents,writes,scrollRestored,detailReads:reads.filter(path=>path.includes(media.id))}));
  await page.close();
 }
 const anonymous=await browser.newPage();
 for(const name of Object.keys(businessPaths)){
  await anonymous.goto(origin+'/personal/'+name);
  await expect(anonymous).toHaveURL(origin+'/login');
  await expect(anonymous.locator('.lo-shell')).toHaveCount(0);
 }
 await anonymous.close();
});
