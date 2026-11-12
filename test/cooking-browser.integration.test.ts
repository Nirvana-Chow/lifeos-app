import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect,type Browser,type BrowserServer} from '@playwright/test';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';

test('OPT-IN mobile owner can pick a dish and follow the original recipe', {
 skip:process.env.RUN_COOKING_BROWSER_TESTS!=='1'&&'Requires native Chrome and an isolated synthetic Next fixture',
 timeout:120_000,
},async t=>{
 const source=resolve(import.meta.dirname,'..');
 const root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-cooking-'));
 let browser:Browser|undefined,browserServer:BrowserServer|undefined,browserProcess:FixtureProcess|undefined,server:FixtureProcess|undefined;
 t.after(()=>cleanupAuthThemeFixture({root,browser,browserServer,browserProcess,server}));
 await mkdir(join(root,'app','personal'),{recursive:true});
 await mkdir(join(root,'app','login'));
 await Promise.all([
  cp(join(source,'src'),join(root,'src'),{recursive:true}),
  cp(join(source,'app','personal','cooking'),join(root,'app','personal','cooking'),{recursive:true}),
  ...['layout.tsx','globals.css','theme.css'].map(name=>cp(join(source,'app',name),join(root,'app',name))),
  cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  symlink(join(source,'node_modules'),join(root,'node_modules')),
  symlink(join(source,'components'),join(root,'components')),
 ]);
 await writeFile(join(root,'src/platform/runtime.ts'),"export const readPlatformPagePrincipal=async(h:Headers)=>h.get('x-synthetic-fixture')==='cooking'?{ownerId:'synthetic-cooking'}:null;");
 await writeFile(join(root,'app/login/page.tsx'),"export default function Login(){return <h1>Fixture login</h1>;}");
 const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{
  cwd:root,detached:true,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],
 });
 server=trackAuthThemeProcess(child,true);
 const origin=await new Promise<string>((accept,reject)=>{
  let output='';
  const timer=setTimeout(()=>reject(Error('Fixture startup timeout: '+output.slice(-1600))),30_000);
  const collect=(chunk:Buffer)=>{output=(output+String(chunk)).slice(-3000);const url=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url){clearTimeout(timer);accept(url);}};
  child.stdout.on('data',collect);child.stderr.on('data',collect);
  child.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture exited: '+output));});
 });
 browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
 browserProcess=trackAuthThemeProcess(browserServer.process());browser=await chromium.connect(browserServer.wsEndpoint());
 const anonymous=await browser.newPage();
 await anonymous.goto(origin+'/personal/cooking',{timeout:65_000});
 await expect(anonymous).toHaveURL(origin+'/login');
 await anonymous.close();
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,colorScheme:'light',extraHTTPHeaders:{'x-synthetic-fixture':'cooking'}});
 await page.route(origin+'/api/platform/status',route=>route.fulfill({status:200,contentType:'application/json',body:'{}'}));
 await page.route(origin+'/api/platform/personal/status',route=>route.fulfill({json:{scope:'personal-manual-candidate',storageVerified:true,ownerId:'synthetic-cooking',spaceId:'synthetic-space'}}));
 const errors:string[]=[],writes:string[]=[],remote:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',req=>{if(!['GET','HEAD'].includes(req.method()))writes.push(req.method());if(!req.url().startsWith(origin+'/'))remote.push(req.url());});
 await page.goto(origin+'/personal/cooking',{timeout:65_000});
 if(process.env.LIFEOS_COOKING_EVIDENCE_DIR){
  const folder=resolve(process.env.LIFEOS_COOKING_EVIDENCE_DIR);
  await mkdir(folder,{recursive:true});
  await page.screenshot({path:join(folder,'cooking-mobile.png'),fullPage:true});
  const desktop=await browser.newPage({viewport:{width:1365,height:900},extraHTTPHeaders:{'x-synthetic-fixture':'cooking'}});
  await desktop.goto(origin+'/personal/cooking',{timeout:65_000});
  await expect(desktop.getByRole('group',{name:'菜谱分类'}).getByRole('button')).toHaveCount(11);
  assert.equal(await desktop.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await desktop.screenshot({path:join(folder,'cooking-desktop.png'),fullPage:true});
  await desktop.close();
 }
 await page.getByRole('button',{name:'打开导航'}).click();
 const menu=page.getByRole('dialog').getByRole('navigation',{name:'主导航'});
 await expect(menu.getByRole('link',{name:'做饭',exact:true})).toHaveAttribute('href','/personal/cooking');
 await page.keyboard.press('Escape');
 const picks=page.getByRole('region',{name:'今天做什么'});
 await expect(picks.getByRole('link')).toHaveCount(3);
 const first=await picks.getByRole('link').allTextContents();
 await picks.getByRole('button',{name:'换一批'}).click();
 const next=await picks.getByRole('link').allTextContents();
 assert.ok(next.every(label=>!first.includes(label)));
 const food=page.getByRole('searchbox',{name:'手头食材'});
 await food.fill('西红柿');
 const categories=page.getByRole('group',{name:'菜谱分类'});
 await categories.getByRole('button',{name:/^素菜/}).click();
 await expect(categories.getByRole('button',{name:/^素菜/})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('searchbox',{name:'搜索菜名'}).fill('西红柿炒鸡蛋');
 await page.getByRole('button',{name:'随机选一道',exact:true}).click();
 const random=page.getByRole('status',{name:'随机选菜结果'});
 await expect(random.getByRole('link')).toHaveText(/西红柿炒鸡蛋/);
 await page.getByRole('searchbox',{name:'搜索菜名'}).fill('不存在的菜名');
 await expect(random).toHaveCount(0);
 await expect(page.getByRole('button',{name:'随机选一道',exact:true})).toBeDisabled();
 await page.getByRole('searchbox',{name:'搜索菜名'}).fill('西红柿炒鸡蛋');
 const target=page.getByRole('link',{name:/西红柿炒鸡蛋/}).first();
 await expect(target).toBeVisible();
 assert.ok(await food.evaluate(node=>node.getBoundingClientRect().height>=44));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 const path=await target.getAttribute('href');
 assert.ok(path?.startsWith('/personal/cooking/'));
 await target.click();
 await expect(page).toHaveURL(origin+path);
 await expect(page.getByRole('heading',{name:'西红柿炒鸡蛋',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'食材和工具'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'烹饪步骤'})).toBeVisible();
 await expect(page.getByRole('link',{name:'查看原菜谱'})).toHaveAttribute('href',/^https:\/\/github\.com\/Anduin2017\/HowToCook\/blob\//);
 await page.getByRole('button',{name:'切换到深色模式'}).click();
 await expect(page.locator('html')).toHaveAttribute('data-lifeos-theme','dark');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 const invalid=await page.goto(origin+'/personal/cooking/0000000000000000');
 assert.equal(invalid?.status(),404);
 assert.deepEqual(errors,[]);
 assert.deepEqual(writes,[]);
 assert.deepEqual(remote,[]);
});
