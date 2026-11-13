import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect,type Browser,type BrowserServer,type Route} from '@playwright/test';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';
import {MemoryPort} from './helpers/platform.ts';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {getRecipe,listRecipes} from '../src/cooking/catalog.ts';

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
 const collectError=(message:string)=>{errors.push(message);};
 const collectRemote=(url:string)=>{if(!url.startsWith(origin+'/'))remote.push(url);};
 page.on('pageerror',error=>collectError(error.message));
 page.on('request',req=>{if(!['GET','HEAD'].includes(req.method()))writes.push(req.method()+' '+new URL(req.url()).pathname);collectRemote(req.url());});
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
 // World recipes reuse the same ingredient/category/random/detail flow.
 await page.goto(origin+'/personal/cooking');
 await page.getByRole('searchbox',{name:'手头食材'}).fill('番茄');
 await page.getByRole('group',{name:'菜谱分类'}).getByRole('button',{name:/^汤品/}).click();
 await page.getByRole('searchbox',{name:'搜索菜名'}).fill('Gazpacho');
 await page.getByRole('button',{name:'随机选一道',exact:true}).click();
 await expect(page.getByRole('status',{name:'随机选菜结果'}).getByRole('link')).toHaveText(/西班牙番茄冷汤/);
 const worldLink=page.getByRole('region',{name:'菜谱库'}).getByRole('link',{name:/西班牙番茄冷汤/});
 await expect(worldLink).toBeVisible();
 const worldPath=await worldLink.getAttribute('href');
 assert.ok(worldPath);
 await worldLink.click();
 await expect(page.getByRole('heading',{name:'西班牙番茄冷汤',exact:true})).toBeVisible();
 await expect(page.getByText('Gazpacho · 西班牙',{exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'CC BY-SA 4.0',exact:true})).toHaveAttribute('href','https://creativecommons.org/licenses/by-sa/4.0/');
 await expect(page.getByRole('link',{name:'原作者与修订记录'})).toHaveAttribute('href',/action=history$/);
 await expect(page.getByText('份量：原文未标注',{exact:true})).toBeVisible();
 await expect(page.getByText(/AI 辅助中文翻译/)).toBeVisible();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 const worldId=worldPath.split('/').at(-1)!;
 assert.equal((await page.request.get(origin+'/personal/cooking/history?recipe='+worldId)).status(),404);
 await page.goto(origin+'/personal/cooking');
 await page.getByRole('searchbox',{name:'搜索菜名'}).fill('墨西哥');
 await expect(page.getByRole('region',{name:'菜谱库'}).getByRole('link')).toHaveCount(2);
 const invalid=await page.goto(origin+'/personal/cooking/0000000000000000');
 assert.equal(invalid?.status(),404);
 assert.deepEqual(errors,[]);
 assert.deepEqual(writes,[]);
 assert.deepEqual(remote,[]);

 if(process.env.RUN_COOKING_LOG_BROWSER_TESTS==='1')await t.test('cooking record survives an unknown response and a browser refresh',async()=>{
  const ownerId='synthetic-cooking',ownerEmail='cooking-fixture@example.invalid',spaceId='synthetic-space';
  const repository=new MemoryPort();
  let sessionValid=true;
  repository.readCurrentSnapshot=async owner=>structuredClone([...repository.rows.values()].filter(row=>row.ownerId===owner));
  const handle=createPersonalPlatformHandler({
   config:{ownerId,ownerEmail,spaceId,databaseName:'synthetic',allowedTypes:['todo','journal'],approval:'personal-manual-v1',baseURL:origin,cookingEnabled:true},
   repository,storageVerified:true,assertWritable:async()=>{},
   sessions:{read:async headers=>sessionValid&&headers.get('x-synthetic-fixture')==='cooking'?{userId:ownerId,email:ownerEmail}:null},
  });
  await page.unroute(origin+'/api/platform/personal/status');
  const posts:{key:string;body:string}[]=[];
  let loseNextResponse=true;
  const nativeRequest=async (route:Route)=>{
   const req=route.request(),headers=await req.allHeaders(),body=req.postData();
   const response=await handle(new Request(req.url(),{method:req.method(),headers:{...headers,host:new URL(origin).host},...(body?{body}:{})}));
   if(req.method()==='POST'&&new URL(req.url()).pathname==='/api/platform/personal/cooking'){
    posts.push({key:headers['idempotency-key']??'',body:body??''});
    if(loseNextResponse&&response.status===201){loseNextResponse=false;await route.abort();return;}
   }
   await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
  };
  await page.route(origin+'/api/platform/personal/**',nativeRequest);
  // Even with a valid writable cooking grant, unsupported world pins have no action.
  await page.goto(origin+worldPath);
  await expect(page.getByRole('link',{name:'记录这次',exact:true})).toHaveCount(0);
  const worldRecipe=getRecipe(listRecipes().find(recipe=>recipe.name==='西班牙番茄冷汤')!.id)!;
  const unsupported=await handle(new Request(origin+'/api/platform/personal/cooking',{
   method:'POST',headers:{host:new URL(origin).host,origin,'content-type':'application/json','idempotency-key':'synthetic-world-pin','x-synthetic-fixture':'cooking'},
   body:JSON.stringify({spaceId,confirmed:true,fields:{title:'合成世界菜谱记录',text:'',occurredOn:'2031-05-07',personal:{type:'cooking',schemaVersion:1,recipe:{id:worldRecipe.id,sourceUrl:worldRecipe.sourceUrl}}}}),
  }));
  assert.equal(unsupported.status,400);
  assert.equal(repository.rows.size,0);
  assert.equal(repository.receipts.size,0);
  await page.goto(origin+path);
  await page.getByRole('link',{name:'记录这次',exact:true}).click();
  await expect(page.getByRole('heading',{name:'做饭历史',exact:true})).toBeVisible();
  await expect(page.getByLabel('菜名',{exact:true})).toHaveValue('西红柿炒鸡蛋');
  const date=page.getByLabel('做饭日期',{exact:true});
  await expect(date).toHaveValue('');
  await date.fill('2031-05-07');
  await page.getByLabel('做饭笔记（选填）').fill('合成试做：下次少放盐。');
  await page.getByRole('button',{name:'确认保存',exact:true}).click();
  const recover=page.getByRole('button',{name:'继续确认上次保存',exact:true});
  await expect(recover).toBeVisible();
  assert.equal(repository.rows.size,1);
  page.once('dialog',dialog=>void dialog.accept());
  await page.reload();
  await expect(recover).toBeVisible();
  await recover.click();
  await expect(page.getByText('已保存这次做饭记录。',{exact:true})).toBeVisible();
  assert.equal(repository.rows.size,1);
  assert.equal(repository.receipts.size,1);
  assert.equal(posts.length,2);
  assert.ok(posts[0]!.key);
  assert.deepEqual(posts[0],posts[1]);
  await page.reload();
  const history=page.getByRole('region',{name:'做过的菜'});
  const saved=history.getByRole('button',{name:/西红柿炒鸡蛋.*2031-05-07/});
  await expect(saved).toBeVisible();
  await saved.click();
  await expect(page.getByLabel('做饭笔记（选填）')).toHaveValue('合成试做：下次少放盐。');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await expect(page.getByText('照片待接入。',{exact:true})).toBeVisible();
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  if(process.env.LIFEOS_COOKING_EVIDENCE_DIR)await page.screenshot({path:join(resolve(process.env.LIFEOS_COOKING_EVIDENCE_DIR),'history-mobile-dark.png'),fullPage:true});
  const desktop=await browser!.newPage({viewport:{width:1365,height:900},colorScheme:'light',extraHTTPHeaders:{'x-synthetic-fixture':'cooking'}});
  try{
   desktop.on('pageerror',error=>collectError(error.message));
   desktop.on('request',req=>collectRemote(req.url()));
   await desktop.route(origin+'/api/platform/status',route=>route.fulfill({json:{}}));
   await desktop.route(origin+'/api/platform/personal/**',nativeRequest);
   await desktop.goto(origin+'/personal/cooking/history',{timeout:65_000});
   await desktop.getByRole('region',{name:'做过的菜'}).getByRole('button',{name:/西红柿炒鸡蛋.*2031-05-07/}).click();
   await expect(desktop.getByLabel('做饭笔记（选填）')).toHaveValue('合成试做：下次少放盐。');
   await expect(desktop.getByText('照片待接入。',{exact:true})).toBeVisible();
   assert.equal(await desktop.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   if(process.env.LIFEOS_COOKING_EVIDENCE_DIR)await desktop.screenshot({path:join(resolve(process.env.LIFEOS_COOKING_EVIDENCE_DIR),'history-desktop-light.png'),fullPage:true});
  }finally{await desktop.close();}
  await page.getByLabel('做饭笔记（选填）').fill('这个修改没有得到授权。');
  sessionValid=false;
  await page.getByRole('button',{name:'确认保存',exact:true}).click();
  await expect(history).toHaveCount(0);
  await expect(page.getByLabel('菜名',{exact:true})).toHaveCount(0);
  assert.equal(repository.historyRows.length,1);
  assert.deepEqual(errors,[]);
  assert.deepEqual(remote,[]);
 });
});
