import test from 'node:test';
import assert from 'node:assert/strict';
import {cp,mkdir,mkdtemp,readFile,symlink,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,expect,type Browser,type BrowserServer,type Locator} from '@playwright/test';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';

async function glyph(control:Locator){
 await expect(control).toBeVisible();
 return control.locator('svg').evaluate(svg=>({
  drawing:svg.innerHTML,
  box:svg.getAttribute('viewBox'),
  line:svg.getAttribute('stroke-width'),
  hidden:svg.getAttribute('aria-hidden'),
  width:svg.getBoundingClientRect().width,
  height:svg.getBoundingClientRect().height,
  colorMatches:getComputedStyle(svg).stroke===getComputedStyle(svg).color,
 }));
}

test('OPT-IN public navigation aligns semantic Lucide icons across actual owner, legacy and review routes',{
 skip:process.env.RUN_NAVIGATION_ICONS_BROWSER_TESTS!=='1'&&'Requires disposable synthetic Next fixture and Chromium',timeout:120000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-navigation-icons-'));
 let server:FixtureProcess|undefined,browserProcess:FixtureProcess|undefined,browserServer:BrowserServer|undefined,browser:Browser|undefined;
 t.after(()=>cleanupAuthThemeFixture({root,browser,browserServer,browserProcess,server}));
 await mkdir(join(root,'app/personal/[...section]'),{recursive:true});
 await mkdir(join(root,'app/review/admin'),{recursive:true});
 await Promise.all([
  cp(join(source,'src'),join(root,'src'),{recursive:true}),
  ...['app/layout.tsx','app/globals.css','app/theme.css','app/review/admin/page.tsx','postcss.config.mjs'].map(file=>cp(join(source,file),join(root,file))),
  symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components')),
 ]);
 for(const file of ['app/personal/page.tsx','app/personal/layout.tsx','app/personal/[...section]/page.tsx','app/review/admin/layout.tsx']){
  const code=await readFile(join(source,file),'utf8');
  const isolated=code.replace('/src/platform/runtime','/src/navigation-icons-fixture-principal');
  assert.notEqual(isolated,code);
  await writeFile(join(root,file),isolated);
 }
 await writeFile(join(root,'src/navigation-icons-fixture-principal.ts'),`export async function readPlatformPagePrincipal(){return {userId:'icons-synthetic-owner'};} export async function readPlatformPasswordCapability(){return false;} export async function readPlatformLoginCapability(){return {mode:'personal',enabled:true};}`);
 await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
 const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{
  cwd:root,detached:true,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],
 });
 server=trackAuthThemeProcess(child,true);
 let output='';
 const collect=(chunk:Buffer)=>{output=(output+String(chunk)).slice(-5000);};
 child.stdout.on('data',collect);child.stderr.on('data',collect);
 const origin=await new Promise<string>((done,reject)=>{
  const limit=setTimeout(()=>reject(Error(output)),30000);
  const check=()=>{const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(limit);child.stdout.off('data',check);done(match[0]);}};
  child.stdout.on('data',check);child.once('exit',()=>{clearTimeout(limit);reject(Error(output));});check();
 });
 browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
 browserProcess=trackAuthThemeProcess(browserServer.process());
 browser=await chromium.connect(browserServer.wsEndpoint());
 const errors:string[]=[],unexpected:string[]=[];
 async function createPage(width:number,theme:'light'|'dark'){
  const page=await browser!.newPage({viewport:{width,height:880},colorScheme:theme,hasTouch:width<500,reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==origin||request.method()!=='GET'){unexpected.push(request.method()+' '+url.origin);return route.abort();}
   if(!url.pathname.startsWith('/api/'))return route.continue();
   if(url.pathname.endsWith('/status'))return route.fulfill({json:{scope:'personal-manual-candidate',storageVerified:true,ownerId:'icons-synthetic-owner',spaceId:'icons-synthetic-space',allowedTypes:['todo'],calendarEnabled:true}});
   if(url.pathname==='/api/platform/personal/todo/workspace-snapshot'){
    const today=url.searchParams.get('today')??'';
    assert.match(today,/^\d{4}-\d{2}-\d{2}$/);
    assert.equal(url.searchParams.get('include'),'access');
    return route.fulfill({json:{scope:'task-workspace-current-snapshot',items:[],total:0,truncated:false,today,observedAt:'2026-11-26T00:00:00Z',access:{scope:'personal-manual-candidate',ownerId:'icons-synthetic-owner',spaceId:'icons-synthetic-space',storageVerified:true,allowedTypes:['todo'],writable:false}}});
   }
   if(url.pathname.endsWith('/overview'))return route.fulfill({json:{scope:'full-current-snapshot',items:[],total:0,truncated:false,today:url.searchParams.get('today'),observedAt:'2026-11-26T00:00:00Z'}});
   return route.fulfill({status:404,json:{}});
  });
  return page;
 }
 const desktop=await createPage(1365,'light');
 await desktop.goto(origin+'/personal?page=tasks');
 await expect(desktop.locator('[data-task-grid="reui"]').getByText('暂无待办',{exact:true})).toBeVisible();
 const primaryNav=desktop.getByRole('navigation',{name:'主导航',exact:true});
 const primarySettings=desktop.getByRole('button',{name:'打开设置',exact:true});
 const primarySearch=desktop.locator('header').getByRole('button',{name:'搜索本人记录',exact:true});
 const primaryTodo=primaryNav.getByRole('button',{name:'待办',exact:true});
 const primaryCalendar=primaryNav.getByRole('link',{name:'日程',exact:true});
 const primaryCollapse=desktop.getByRole('button',{name:'收起侧栏',exact:true});
 await expect(primarySearch).toHaveAttribute('aria-haspopup','dialog');
 const [settings,search,todo,calendar,collapse]=await Promise.all([primarySettings,primarySearch,primaryTodo,primaryCalendar,primaryCollapse].map(glyph));
 await primaryCollapse.press('Enter');
 const expand=await glyph(desktop.getByRole('button',{name:'展开侧栏',exact:true}));
 assert.notEqual(collapse.drawing,expand.drawing);
 await desktop.getByRole('button',{name:'展开侧栏',exact:true}).press('Enter');
 const preview=process.env.LIFEOS_NAVIGATION_ICON_SCREENSHOT_DIR;
 if(preview)await desktop.screenshot({path:join(preview,'synthetic-navigation-icons-1365.png')});

 const mobile=await createPage(390,'dark');
 await mobile.goto(origin+'/personal?page=tasks');
 await expect(mobile.locator('[data-task-grid="reui"]').getByText('暂无待办',{exact:true})).toBeVisible();
 const open=mobile.getByRole('button',{name:'打开导航',exact:true});
 const mobileMenu=await glyph(open);
 await open.press('Enter');
 const menu=mobile.getByRole('dialog',{name:'LifeOS',exact:true});
 await expect(menu).toBeVisible();
 assert.deepEqual(await glyph(menu.getByRole('button',{name:'待办',exact:true})),todo);
 assert.deepEqual(await glyph(menu.getByRole('link',{name:'日程',exact:true})),calendar);
 assert.deepEqual(await glyph(menu.getByRole('button',{name:'设置',exact:true})),settings);
 if(preview)await mobile.screenshot({path:join(preview,'synthetic-navigation-icons-390.png')});
 await mobile.keyboard.press('Escape');
 await expect(open).toBeFocused();
 const mobileSearch=mobile.locator('header').getByRole('button',{name:'搜索本人记录',exact:true});
 assert.deepEqual(await glyph(mobileSearch),search);
 const widePhone=await createPage(430,'light');
 await widePhone.goto(origin+'/personal?page=tasks');
 await expect(widePhone.locator('[data-task-grid="reui"]').getByText('暂无待办',{exact:true})).toBeVisible();
 assert.deepEqual(await glyph(widePhone.locator('header').getByRole('button',{name:'搜索本人记录',exact:true})),search);
 await widePhone.close();

 await desktop.goto(origin+'/personal/growth');
 const legacy=desktop.getByRole('navigation',{name:'工作台导航',exact:true});
 assert.deepEqual(await glyph(legacy.getByRole('link',{name:'事项',exact:true})),todo);
 assert.deepEqual(await glyph(legacy.getByRole('link',{name:'个人设置',exact:true})),settings);
 const legacyCollapse=desktop.getByRole('button',{name:'折叠侧栏',exact:true});
 assert.deepEqual(await glyph(legacyCollapse),collapse);
 await legacyCollapse.press('Enter');
 assert.deepEqual(await glyph(desktop.getByRole('button',{name:'展开侧栏',exact:true})),expand);
 await mobile.goto(origin+'/personal/growth');
 const legacyOpen=mobile.getByRole('button',{name:'打开导航',exact:true});
 assert.deepEqual(await glyph(legacyOpen),mobileMenu);
 await legacyOpen.press('Enter');
 const legacyDrawer=mobile.getByRole('dialog',{name:'手机导航',exact:true});
 assert.deepEqual(await glyph(legacyDrawer.getByRole('link',{name:'事项',exact:true})),todo);
 await mobile.keyboard.press('Escape');
 await expect(legacyOpen).toBeFocused();

 await desktop.goto(origin+'/review/admin');
 const review=desktop.getByRole('navigation',{name:'工作台导航',exact:true});
 assert.deepEqual(await glyph(desktop.locator('header').getByRole('link',{name:'统一搜索',exact:true})),search);
 assert.deepEqual(await glyph(review.getByRole('link',{name:'日程',exact:true})),calendar);
 for(const icon of [settings,search,todo,calendar,collapse,expand,mobileMenu]){
  assert.deepEqual([icon.box,icon.line,icon.hidden,icon.width,icon.height,icon.colorMatches],['0 0 24 24','2','true',19,19,true]);
 }
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
});
