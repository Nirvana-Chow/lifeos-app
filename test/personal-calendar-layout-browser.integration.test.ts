import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {test} from 'node:test';
import {chromium,expect,type Browser,type BrowserServer,type Page} from '@playwright/test';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {PersonalService} from '../src/personal-candidate/service.ts';
import type {PersonalConfig} from '../src/personal-candidate/config.ts';
import {MemoryPort} from './helpers/platform.ts';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';

test('OPT-IN owner schedule keeps actual records across readable month and week views', {
  skip:process.env.RUN_PERSONAL_CALENDAR_LAYOUT_BROWSER!=='1'&&'Requires an isolated loopback Next and Chromium fixture',
  timeout:150_000,
},async t=>{
  const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-calendar-layout-'));
  let browser:Browser|undefined,browserServer:BrowserServer|undefined,browserProcess:FixtureProcess|undefined,server:FixtureProcess|undefined;
  t.after(()=>cleanupAuthThemeFixture({root,browser,browserServer,browserProcess,server}));
  const path=join(root,'app/personal/schedule');
  await mkdir(path,{recursive:true});
  await Promise.all([
    cp(join(source,'src'),join(root,'src'),{recursive:true}),
    ...['layout.tsx','globals.css','theme.css'].map(file=>cp(join(source,'app',file),join(root,'app',file))),
    cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
    symlink(join(source,'node_modules'),join(root,'node_modules')),
    symlink(join(source,'components'),join(root,'components')),
  ]);
  await writeFile(join(path,'page.tsx'),"import {PersonalCalendarPage} from '../../../src/calendar-candidate/personal-page';export default function Page(){return <PersonalCalendarPage/>;}");
  const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],
    {cwd:root,detached:true,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
  server=trackAuthThemeProcess(child,true);
  const origin=await new Promise<string>((accept,reject)=>{
    let log='';
    const timer=setTimeout(()=>reject(Error('calendar fixture startup: '+log)),30_000);
    const collect=(chunk:Buffer)=>{
      log=(log+String(chunk)).slice(-3000);
      const address=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if(address){clearTimeout(timer);accept(address);}
    };
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    child.once('exit',()=>{clearTimeout(timer);reject(Error('calendar fixture exited: '+log));});
  });
  browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
  browserProcess=trackAuthThemeProcess(browserServer.process());
  browser=await chromium.connect(browserServer.wsEndpoint());

  const config:PersonalConfig={ownerId:'synthetic-calendar-owner',ownerEmail:'synthetic@example.test',spaceId:'synthetic-calendar-space',
    databaseName:'lifeos_platform_test_local',baseURL:origin,approval:'personal-manual-v1',allowedTypes:['calendar'],calendarEnabled:true};
  const repository=new MemoryPort();
  repository.readCurrentSnapshot=async owner=>structuredClone([...repository.rows.values()].filter(entry=>entry.ownerId===owner));
  const service=new PersonalService(repository,config);
  const seed=async(title:string,schedule:unknown,key:string)=>{
    const {entry}=await service.mutate(config.ownerId,'calendar',null,{
    spaceId:config.spaceId,confirmed:true,fields:{title,text:'',occurredOn:null,personal:{type:'calendar',schemaVersion:1,
      calendarKind:'event',schedule,links:{project:null,domain:null,people:[]}}},
    },key);
    return {id:entry.id,title};
  };
  const allDay=await seed('合成全天日程',{kind:'all-day',startDate:'2030-10-31',endDate:'2030-11-02'},'calendar-layout-all-day');
  const timed=await seed('合成跨夜长标题日程，用于核对手机明细行能完整显示标题',{kind:'timed',startAt:'2030-11-01T23:30:00+08:00',
    endAt:'2030-11-02T01:05:00+08:00',timeZone:'Asia/Shanghai'},'calendar-layout-timed');
  const initial=structuredClone([...repository.rows.values()]);
  const handler=createPersonalPlatformHandler({repository,config,storageVerified:true,
    sessions:{read:async()=>({userId:config.ownerId,email:config.ownerEmail})},assertWritable:async()=>{throw Error('Read-only fixture');}});
  const shell=await fetch(origin+'/personal/schedule');
  assert.equal(shell.status,200);
  await shell.text();
  for(const [width,theme] of [[1365,'light'],[390,'dark']] as const){
    const page:Page=await browser.newPage({viewport:{width,height:900},colorScheme:theme,timezoneId:'Asia/Shanghai'});
    const requests:{method:string;url:URL}[]=[],errors:string[]=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin!==origin)return route.abort();
      if(!url.pathname.startsWith('/api/'))return route.continue();
      requests.push({method:request.method(),url});
      if(request.method()!=='GET')return route.abort();
      const result=await handler(new Request(request.url(),{headers:{host:url.host}}));
      return route.fulfill({status:result.status,headers:Object.fromEntries(result.headers),body:await result.text()});
    });
    const firstStatus=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/platform/personal/calendar/status');
    await page.goto(origin+'/personal/schedule',{waitUntil:'load',timeout:80_000});
    const availability=await firstStatus;
    assert.equal(availability.status(),200);
    assert.equal((await availability.json()).configured,true);
    const views=page.getByRole('group',{name:'日程视图'});
    await expect(views.getByRole('button',{name:'月历',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.getByLabel('月历月份').fill('2030-11');
    const month=page.getByRole('table',{name:'2030-11 月历',exact:true});
    await expect(month).toBeVisible();
    await expect(month.getByRole('button',{name:'查看 2030-10-31 的日程',exact:true})).toHaveCount(0);
    await month.getByRole('button',{name:'查看 2030-11-01 的日程',exact:true}).click();
    const agenda=page.getByRole('region',{name:'所选日期日程'});
    await expect(agenda).toContainText('全天');
    await expect(agenda).toContainText('23:30 起');
    await expect(agenda.getByRole('button',{name:timed.title,exact:true})).toBeVisible();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    const calendarWidth=(await month.boundingBox())!.width;
    console.log('CALENDAR_LAYOUT '+JSON.stringify({viewport:width,calendarWidth,theme}));
    assert.ok(calendarWidth<=width+1);

    await views.getByRole('button',{name:'周历',exact:true}).click();
    const week=page.getByRole('table',{name:'2030-10-28 起的周历',exact:true});
    await expect(week).toBeVisible();
    await week.getByRole('button',{name:'查看 2030-10-31 的日程',exact:true}).click();
    await expect(agenda.getByRole('button',{name:allDay.title,exact:true})).toBeVisible();
    await expect(agenda.getByRole('button',{name:timed.title,exact:true})).toHaveCount(0);
    await week.getByRole('button',{name:'查看 2030-11-02 的日程',exact:true}).click();
    await expect(agenda).toContainText('至 01:05');
    await expect(agenda.getByRole('button',{name:allDay.title,exact:true})).toHaveCount(0);
    await agenda.getByRole('button',{name:timed.title,exact:true}).click();
    await expect(page.getByRole('dialog').getByLabel('名称',{exact:true})).toHaveValue(timed.title);
    await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();

    await page.getByRole('button',{name:'下周',exact:true}).click();
    await expect(page.getByRole('table',{name:'2030-11-04 起的周历',exact:true})).toBeVisible();
    await expect(agenda).toContainText('已读取的来源中，这一天没有日程。');
    await views.getByRole('button',{name:'表格',exact:true}).click();
    await expect(page.getByRole('button',{name:'查看日程：'+timed.title,exact:true})).toBeVisible();
    await expect(page.getByText('订阅节假日与节气：未连接',{exact:true})).toBeVisible();
    assert.ok(requests.every(({method})=>method==='GET'));
    assert.ok(requests.some(({url})=>url.pathname.endsWith(timed.id)));
    assert.ok(requests.some(({url})=>url.searchParams.get('from')==='2030-10-28'&&url.searchParams.get('to')==='2030-11-04'));
    assert.deepEqual(errors,[]);
    await page.close();
  }
  assert.deepEqual([...repository.rows.values()],initial);
});
