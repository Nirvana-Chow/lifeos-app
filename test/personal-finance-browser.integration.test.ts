import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {PersonalFinanceService} from '../src/personal-finance/service.ts';
import {handlePersonalFinance} from '../src/personal-finance/http.ts';
import {MemoryPort} from './helpers/platform.ts';

const source=resolve(import.meta.dirname,'..');
test('OPT-IN personal finance real Chrome flow in the established shell, mobile/desktop themes',{
 skip:process.env.RUN_PERSONAL_FINANCE_BROWSER_TESTS!=='1'&&'Requires disposable internal fixture and native Chrome',timeout:180_000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-personal-finance-browser-'));
 // Without the optional persistent host, the real finance route must supply
 // its own privacy boundary.
 await mkdir(join(root,'app/personal/[...section]'),{recursive:true});
 await mkdir(join(root,'app/login'),{recursive:true});
 await Promise.all([
  ...['layout.tsx','globals.css','theme.css','personal/[...section]/page.tsx'].map(name=>cp(join(source,'app',name),join(root,'app',name))),
  cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  cp(join(source,'src'),join(root,'src'),{recursive:true}),
  symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components')),
  writeFile(join(root,'app/login/page.tsx'),`export default function Page(){return <h1>Synthetic login</h1>}`),
 ]);
 await writeFile(join(root,'src/platform/runtime.ts'),`
export async function readPlatformPagePrincipal(headers:Headers) {
 return headers.get('cookie')?.split('; ').includes('finance_fixture=isolated')
  ? {userId:'finance-browser-fixture-owner'} : null;
}
`);
 const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 const stopped=once(server,'exit');let log='';server.stderr.on('data',chunk=>{log+=String(chunk);});
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await new Promise<string>((accept,reject)=>{const timer=setTimeout(()=>reject(Error('Finance fixture did not start')),30000);server.once('exit',()=>{clearTimeout(timer);reject(Error('Finance fixture exited'));});server.stdout.on('data',chunk=>{log+=String(chunk);const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});});
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 const evidence=join(tmpdir(),'lifeos-finance-browser-evidence-20261105');await mkdir(evidence,{recursive:true});
 for(const width of [360,1365])for(const theme of ['light','dark'] as const){
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme,timezoneId:'Asia/Shanghai'}),errors:string[]=[],writes:{method:string;key:string}[]=[];
  await page.context().addCookies([{name:'finance_fixture',value:'isolated',url:origin}]);
  const repo=new MemoryPort();repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(row=>row.ownerId===owner));const ownerId='finance-browser-fixture-owner',spaceId='finance-browser-fixture-space',service=new PersonalFinanceService(repo,{ownerId,spaceId,enabled:true,writable:true});
  let denySnapshot=false;
  let sessionDenial:401|403|undefined;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin)return route.abort();
   if(url.pathname==='/api/platform/status')return route.fulfill({status:sessionDenial??200,json:{synthetic:true}});
   if(!url.pathname.startsWith('/api/platform/personal/finance'))return route.continue();
   if(denySnapshot&&url.pathname.endsWith('/snapshot'))return route.fulfill({status:403,json:{error:{code:'FORBIDDEN',message:'合成验收：快照授权已撤回'}}});
   const headers=new Headers(request.headers());headers.set('host',url.host);const body=request.postData();
   if(!['GET','HEAD'].includes(request.method()))writes.push({method:request.method(),key:headers.get('idempotency-key')!});
   try{const response=await handlePersonalFinance(new Request(url,{method:request.method(),headers,...(body?{body}:{})}),{ownerId,baseURL:origin,service,assertOwner:async()=>{},guard:async()=>{}});assert.ok(response);return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});}
   catch(error:any){return route.fulfill({status:error.status??503,json:{error:{code:error.code??'UNAVAILABLE',message:error.message}}});}
  });
  await page.goto(origin+'/personal/finance',{waitUntil:'domcontentloaded',timeout:60000});await expect(page.getByRole('heading',{name:'还没有个人流水',exact:true})).toBeVisible({timeout:30_000});
  await page.getByRole('button',{name:'记一笔',exact:true}).click();await page.getByLabel('金额（元 · CNY）',{exact:true}).fill('29.01');await page.getByLabel('摘要 / 备注',{exact:true}).fill('Explicit synthetic finance fixture');await page.getByRole('button',{name:'保存流水',exact:true}).click();
  await expect(page.getByText('流水已保存并独立读回。',{exact:true})).toBeVisible();assert.equal(repo.rows.size,1);
  await expect(page.locator('[data-personal-finance-grid="reui"]')).toBeVisible();const rowButton=page.getByRole('button',{name:/^查看流水：/});await rowButton.click();
  await expect(page.getByLabel('金额（元 · CNY）',{exact:true})).toHaveValue('29.01');await page.getByLabel('摘要 / 备注',{exact:true}).fill('Edited synthetic finance fixture');await page.getByRole('button',{name:'保存流水',exact:true}).click();await expect(page.getByText('流水已保存并独立读回。',{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByRole('button',{name:/^查看流水：/})).toContainText('Edited synthetic finance fixture');await page.getByRole('button',{name:/^查看流水：/}).click();await page.getByText('来源与历史',{exact:true}).click();await expect(page.getByText('已读回全部版本',{exact:true})).toBeVisible();await expect(page.getByText('版本 2',{exact:true})).toBeVisible();
  const dialog=page.getByRole('dialog');assert.ok(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1),'dialog must fit mobile width');await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'账户与分类',exact:true}).click();await expect(page.getByText('尚未填写账户引用。',{exact:true})).toBeVisible();await page.getByRole('button',{name:'流水',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'page must not overflow the viewport');assert.deepEqual(errors,[]);assert.deepEqual(writes.map(write=>write.method),['POST','PATCH']);assert.notEqual(writes[0].key,writes[1].key);assert.equal([...repo.rows.values()][0].revision,2);
  await expect(page.getByRole('region',{name:'账户间转账'})).toContainText('暂无账户间转账');
  await service.create(ownerId,{spaceId,confirmed:true,fields:{kind:'transfer',currency:'CNY',amountMinor:2000,occurredOn:'2030-11-05',fromAccountRef:'synthetic-a',toAccountRef:'synthetic-b'}},'finance-chart-transfer');
  await service.create(ownerId,{spaceId,confirmed:true,fields:{kind:'income',currency:'CNY',amountMinor:10000,occurredOn:'2030-11-05',notes:'Isolated chart income'}},'finance-chart-source');
  await page.getByRole('button',{name:'刷新',exact:true}).click();
  const chart=page.getByRole('img',{name:'记录收支流向图'});
  await expect(chart).toHaveAccessibleDescription(/100\.00.*29\.01.*70\.99/);
  await expect(page.getByRole('region',{name:'账户间转账'})).toContainText('已记录 1 笔 · 转出与转入各 CNY 20.00');
  await page.getByLabel('搜索',{exact:true}).fill('Isolated chart income');
  await expect(page.getByText('显示 1 条流水',{exact:false})).toBeVisible();
  await expect(chart).toHaveAccessibleDescription(/100\.00.*29\.01.*70\.99/);
  await expect(page.getByText('暂无已核准的资产及负债快照来源。余额和净资产未知。',{exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'资产快照'}).locator('dd')).toHaveText(['未取得','未知','未知','未知']);
  await page.screenshot({path:join(evidence,`finance-${theme}-${width}.png`),fullPage:true});
  if (width===360&&theme==='light') {
   await service.create(ownerId,{spaceId,confirmed:true,fields:{kind:'expense',currency:'CNY',amountMinor:6099,occurredOn:'2030-11-05',notes:'Isolated high expense ratio'}},'finance-chart-high-expense');
   await page.getByRole('button',{name:'刷新',exact:true}).click();
   await expect(chart).toHaveAccessibleDescription(/100\.00.*90\.00.*10\.00/);
   assert.ok(await chart.evaluate(element=>{
    const svg=element as unknown as SVGSVGElement,{y,height}=svg.viewBox.baseVal;
    return Array.from(svg.querySelectorAll<SVGGraphicsElement>('[data-flow-node],[data-flow]')).every(shape=>{
     const box=shape.getBBox();
     return box.y>=y&&box.y+box.height<=y+height;
    });
   }),'the mobile chart must contain every ribbon and node');
   await service.create(ownerId,{spaceId,confirmed:true,fields:{kind:'income',currency:'CNY',amountMinor:1000000000000,occurredOn:'2030-11-05',notes:'Isolated large income'}},'finance-chart-large-income');
   await page.getByRole('button',{name:'刷新',exact:true}).click();
   await expect(chart).toHaveAccessibleDescription(/10000000100\.00/);
   assert.ok(await chart.evaluate(element=>{
    const svg=element as unknown as SVGSVGElement,{x,width}=svg.viewBox.baseVal;
    return Array.from(svg.querySelectorAll('text')).every(label=>{
     const box=label.getBBox();
     return box.x>=x&&box.x+box.width<=x+width;
    });
   }),'full amounts must fit in the SVG without hiding digits');
   denySnapshot=true;
   await page.getByRole('button',{name:'刷新',exact:true}).click();
   await expect(page.getByRole('region',{name:'财务记录'}).getByRole('alert')).toContainText('合成验收：快照授权已撤回');
   await expect(chart).toHaveCount(0);
   await expect(page.getByRole('region',{name:'账户间转账'})).toHaveCount(0);
   await expect(page.getByRole('region',{name:'资产快照'})).toHaveCount(0);
  }
  if(theme==='light'){
   denySnapshot=false;
   await page.getByRole('button',{name:'刷新',exact:true}).click();
   await expect(chart).toBeVisible();
   await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
   await expect(page.locator('html'),'standalone finance privacy boundary must conceal cached data before rechecking').toHaveCSS('visibility','hidden');
   await expect(chart).toBeHidden();
   sessionDenial=width===360?401:403;
   const checked=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/platform/status'&&response.status()===sessionDenial);
   await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
   await checked;
   await expect(page).toHaveURL(origin+'/login');
   await expect(page.getByRole('heading',{name:'Synthetic login',exact:true})).toBeVisible();
   await expect(chart).toHaveCount(0);
   assert.deepEqual(writes.map(write=>write.method),['POST','PATCH']);
   console.log('FINANCE_STANDALONE_PRIVACY '+JSON.stringify({width,sessionDenial,concealedBeforeCheck:true,redirect:'/login'}));
  }
  await page.close();
 }
 const anonymous=await browser.newPage();
 await anonymous.goto(origin+'/personal/finance');
 await expect(anonymous).toHaveURL(origin+'/login');
 await expect(anonymous.locator('.lo-shell')).toHaveCount(0);
 await anonymous.close();
 assert.ok(!/Failed to compile|Module not found/.test(log),'fixture compiled actual UI');
});
