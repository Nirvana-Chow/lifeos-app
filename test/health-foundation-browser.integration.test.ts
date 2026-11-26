import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {on} from 'node:events';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect,type Browser,type BrowserServer} from '@playwright/test';
import {emptyHealthFields} from '../src/personal-health/presentation.ts';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';

const spaceId = 'synthetic-health-space';
const observedAt = '2030-11-02T00:00:00.000Z';
function healthRecord(n:number,title:string,kind:'sleep'|'strength'|'frisbee'|'body',state:'planned'|'completed'='completed') {
  const defaults = emptyHealthFields(kind==='sleep'||kind==='body'?kind:'training','Asia/Shanghai');
  const fields = {...defaults,title,occurredOn:'2030-11-02'};
  if (fields.personal.healthKind==='training') {
    fields.personal.activity = kind==='frisbee'?'other':'strength';
    fields.personal.state = state;
    fields.personal.durationMinutes = 30;
  }
  if (fields.personal.healthKind==='body') {
    fields.personal.weight={value:70,unit:'kg'};
    fields.personal.bodyFatPercent=20;
  }
  const id = '10000000-0000-4000-8000-'+String(n).padStart(12,'0');
  return {
    id,revision:1,kind:'inbox',syncState:'draft',externalStatus:null,createdAt:observedAt,updatedAt:observedAt,
    draft:{...fields,disposition:'reference'},
    source:{id,system:'website',externalId:id,version:1,asOf:observedAt,
      original:{marker:'personal-manual-v1',spaceId,type:'health',input:{spaceId,confirmed:true,fields}}},
  };
}

test('OPT-IN desktop Body Basics uses the canonical owner health route', {
  skip:process.env.RUN_HEALTH_FOUNDATION_BROWSER!=='1' && 'Requires isolated Next and Chromium',
  timeout:150000,
}, async t => {
  const source = resolve(import.meta.dirname,'..');
  const root = await mkdtemp(join(tmpdir(),'lifeos-auth-theme-health-foundation-'));
  let server:FixtureProcess|undefined,browserProcess:FixtureProcess|undefined,browser:Browser|undefined,browserServer:BrowserServer|undefined;
  t.after(() => cleanupAuthThemeFixture({root,server,browserProcess,browser,browserServer}));
  await mkdir(join(root,'app/personal/[...section]'),{recursive:true});
  await mkdir(join(root,'app/login'),{recursive:true});
  const appFiles = ['layout.tsx','globals.css','theme.css','personal/layout.tsx','personal/page.tsx','personal/[...section]/page.tsx'];
  await Promise.all([
    ...appFiles.map(file => cp(join(source,'app',file),join(root,'app',file))),
    cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
    cp(join(source,'src'),join(root,'src'),{recursive:true}),
    symlink(join(source,'node_modules'),join(root,'node_modules')),
    symlink(join(source,'components'),join(root,'components')),
  ]);
  await writeFile(join(root,'app/login/page.tsx'),'export default function Login(){return <h1>合成登录页</h1>}');
  await writeFile(join(root,'src/platform/runtime.ts'),`
export const readPlatformPagePrincipal = async (headers:Headers) => headers.get('cookie')?.includes('health-fixture=owner') ? {id:'synthetic-health-owner'} : null;
export const readPlatformPasswordCapability = async () => false;
export const readPlatformLoginCapability = async () => ({sessionDuration:false});`);
  const child = spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{
    cwd:root,detached:true,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],
  });
  server = trackAuthThemeProcess(child,true);
  let origin = '', output = '';
  for await(const [chunk] of on(child.stdout,'data',{signal:AbortSignal.timeout(30000)})){
    output = (output+String(chunk)).slice(-4000);
    const address = output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    if(address && /Ready in\b/.test(output)){origin=address;break;}
  }
  assert.ok(origin);
  // Compile the real local routes before timing browser interactions.
  const startup = {redirect:'manual' as const,signal:AbortSignal.timeout(45000)};
  const anonymous = await fetch(origin+'/personal/health',startup);
  assert.equal(anonymous.status,307);
  assert.equal(anonymous.headers.get('location'),'/login');
  await anonymous.arrayBuffer();
  const login = await fetch(origin+'/login',startup);
  assert.equal(login.status,200);
  await login.arrayBuffer();
  const workspace = await fetch(origin+'/personal',{...startup,headers:{cookie:'health-fixture=owner'}});
  assert.equal(workspace.status,200);
  await workspace.arrayBuffer();
  browserServer = await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
  browserProcess = trackAuthThemeProcess(browserServer.process());
  browser = await chromium.connect(browserServer.wsEndpoint());
  const context = await browser.newContext({viewport:{width:1365,height:900}});
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(origin+'/personal/health');
  await expect(page.getByRole('heading',{name:'合成登录页'})).toBeVisible();
  await context.addCookies([{name:'health-fixture',value:'owner',url:origin}]);

  let healthEnabled = true, denied = false, truncated = false, reads = 0;
  let items = [
    healthRecord(1,'合成睡眠','sleep'),healthRecord(2,'合成健身','strength'),
    healthRecord(3,'合成飞盘计划','frisbee','planned'),healthRecord(4,'合成飞盘实绩','frisbee'),
    healthRecord(5,'合成健身计划','strength','planned'),healthRecord(6,'合成体重体脂','body'),
  ];
  const writes:string[] = [];
  await page.route('**/api/platform/**',async route => {
    const request = route.request(), url = new URL(request.url());
    if(request.method()!=='GET'){writes.push(request.method());return route.fulfill({status:405,json:{}});}
    if(url.pathname.endsWith('/availability'))return route.fulfill({json:{configured:true,loginAllowed:true,transport:'ssh-loopback',origin}});
    if(url.pathname.endsWith('/status'))return route.fulfill({json:{scope:'personal-manual-candidate',ownerId:'synthetic-health-owner',spaceId,storageVerified:true,writable:false,allowedTypes:['todo','journal'],healthEnabled}});
    if(url.pathname.endsWith('/health/snapshot')){
      reads++;
      if(denied)return route.fulfill({status:403,json:{error:{message:'合成读取拒绝'}}});
      return route.fulfill({json:{scope:'full-current-snapshot',total:items.length,truncated,items,observedAt}});
    }
    if(url.pathname.endsWith('/todo/workspace-snapshot'))return route.fulfill({json:{scope:'task-workspace-current-snapshot',total:0,truncated:false,items:[],today:url.searchParams.get('today'),observedAt}});
    if(url.pathname.endsWith('/overview'))return route.fulfill({json:{scope:'full-current-snapshot',total:0,truncated:false,items:[],today:url.searchParams.get('today'),observedAt}});
    const record = items.find(item=>url.pathname.endsWith('/health/'+item.id));
    if(record)return route.fulfill({json:{entry:record}});
    if(url.pathname.endsWith('/history'))return route.fulfill({json:{items:[]}});
    return route.fulfill({status:404,json:{}});
  });
  await page.goto(origin+'/personal');
  const modules = page.locator('header').getByRole('navigation',{name:'切换模块',exact:true});
  const sidebar = page.locator('aside').getByRole('navigation',{name:'主导航',exact:true});
  await modules.getByRole('button',{name:'身体基础',exact:true}).click();
  await sidebar.getByRole('link',{name:'健康',exact:true}).click();
  await expect(page).toHaveURL(origin+'/personal/health');
  const filters = page.getByRole('region',{name:'身体基础记录'});
  const row = (name:string) => page.getByRole('button',{name,exact:true});
  await expect(filters.getByText('饮食 · 未接入')).toBeVisible();
  await filters.getByRole('button',{name:'睡眠',exact:true}).click();
  await expect(row('合成睡眠')).toBeVisible();
  await expect(row('合成健身')).toHaveCount(0);
  await expect(row('合成体重体脂')).toHaveCount(0);
  await filters.getByRole('button',{name:'体重与体脂',exact:true}).click();
  await expect(row('合成体重体脂')).toBeVisible();
  await expect(row('合成睡眠')).toHaveCount(0);
  await expect(row('合成健身')).toHaveCount(0);
  await expect(filters.getByLabel('运动状态')).toHaveCount(0);
  await filters.getByRole('button',{name:'健身训练',exact:true}).click();
  await expect(row('合成健身')).toBeVisible();
  await expect(row('合成飞盘实绩')).toHaveCount(0);
  await filters.getByLabel('运动状态').selectOption('planned');
  await expect(row('合成健身计划')).toBeVisible();
  await expect(row('合成健身')).toHaveCount(0);
  await filters.getByLabel('运动状态').selectOption('completed');
  await expect(row('合成健身')).toBeVisible();
  await expect(row('合成健身计划')).toHaveCount(0);
  await filters.getByRole('button',{name:'飞盘',exact:true}).click();
  await expect(filters.getByText(/只显示活动类别为「其他」/)).toBeVisible();
  await filters.getByLabel('运动状态').selectOption('planned');
  await expect(row('合成飞盘计划')).toBeVisible();
  await expect(row('合成飞盘实绩')).toHaveCount(0);
  await filters.getByLabel('运动状态').selectOption('completed');
  await expect(row('合成飞盘实绩')).toBeVisible();
  await expect(row('合成飞盘计划')).toHaveCount(0);
  await row('合成飞盘实绩').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button',{name:'保存',exact:true})).toBeDisabled();
  // The existing read-only fieldset disables the form buttons. Escape closes the dialog.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await row('运动').click();
  await expect(page.getByRole('heading',{name:'运动日历',exact:true})).toBeVisible();
  await row('趋势').click();
  await expect(page.getByLabel('查看指标')).toBeVisible();
  await page.getByLabel('查看指标').selectOption('trainingMinutes');
  await expect(page.getByText(/2 条训练计划已排除/)).toBeVisible();
  const completedChart = page.getByRole('img',{name:/^已完成训练时长，min，2 条有日期的记录/});
  await expect(completedChart.locator('svg')).toBeVisible();
  for (const width of [390,430]) {
    await page.setViewportSize({width,height:844});
    await expect(page.getByRole('button',{name:'切换到桌面版',exact:true})).toBeVisible();
    const chartWidths = () => completedChart.evaluate(host=>({
      chart:host.clientWidth,
      svg:host.querySelector('svg')?.getBoundingClientRect().width,
      region:host.closest('section[aria-label="健康趋势"]')!.clientWidth,
    }));
    const {region} = await chartWidths();
    assert.ok(region>0 && region<=width);
    await expect.poll(chartWidths,{message:'the completed training chart must fit the active mobile trend region'})
      .toEqual({chart:region,svg:region,region});
    t.diagnostic('mobile trend '+width+'px '+JSON.stringify(await chartWidths()));
  }
  await row('表格').click();
  items = [];
  await row('刷新').click();
  await expect(page.getByText('当前筛选下暂无已读记录。',{exact:true})).toBeVisible();
  await expect(filters.getByText(/历史覆盖未知/)).toBeVisible();

  items = [healthRecord(4,'合成飞盘实绩','frisbee')];
  await row('刷新').click();
  await expect(row('合成飞盘实绩')).toBeVisible();
  for(const [testDenied,testTruncated,message] of [[true,false,'合成读取拒绝'],[false,true,'完整记录未读取完成。']] as const){
    denied = testDenied;
    truncated = testTruncated;
    await row('刷新').click();
    await expect(page.getByRole('alert').filter({hasText:message})).toBeVisible();
    await expect(filters).toHaveCount(0);
    await expect(row('合成飞盘实绩')).toHaveCount(0);
  }
  healthEnabled = false;
  const before = reads;
  await row('刷新').click();
  await expect(page.getByRole('alert').filter({hasText:'此模块尚未开放。'})).toBeVisible();
  await expect(filters).toHaveCount(0);
  assert.equal(reads,before);
  assert.deepEqual(writes,[]);
});
