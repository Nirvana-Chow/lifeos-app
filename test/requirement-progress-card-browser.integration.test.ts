import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {requirements,type Requirement} from '../src/platform/requirements.ts';
import {dateInCalendarZone,shiftCalendarDate} from '../src/calendar-candidate/personal-projection.ts';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {MemoryPort} from './helpers/platform.ts';

test('owner overview shows live-source snippets, honest fallbacks and existing routes on desktop and phone',{
 skip:process.env.RUN_REQUIREMENT_PROGRESS_CARD_BROWSER_TESTS!=='1'&&'Requires isolated Next and Chromium',timeout:180000,
},async t=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-requirement-overview-'));
 await mkdir(join(root,'app','personal'),{recursive:true});
 await Promise.all([cp(join(source,'src'),join(root,'src'),{recursive:true}),
  ...['layout.tsx','globals.css','theme.css'].map(name=>cp(join(source,'app',name),join(root,'app',name))),
  cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components'))]);
 await writeFile(join(root,'app','personal','page.tsx'),`import {LifeOSWorkspace} from '../../src/ui-review/workspace';
 export default async function Page({searchParams}:{searchParams:Promise<{guest?:string;empty?:string}>}){
  const params=await searchParams;const owner=!params.guest,awaitedEmpty=new URLSearchParams(params).has('empty');
  return <LifeOSWorkspace syncUrl state={{status:'ready',data:{tasks:['open','done','cancelled'].map(status=>({id:status,revision:1,title:'待办示例 '+status,status,notes:null,dueOn:null,area:null,project:null,inInbox:false,sourceLabel:null} as const)).filter((_,index)=>!(awaitedEmpty&&index===0)),projects:[],areas:[],today:'2026-11-25',asOf:'2026-11-25T00:00:00Z',coverage:'complete'}}}
  access={{authenticated:owner,writable:false,loginAllowed:true}} viewPreferenceScope={owner?JSON.stringify(['overview-owner','overview-space']):null}/>;
 }`);
 const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{
  cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],
 });
 const stopped=once(child,'exit');
 t.after(async()=>{child.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 let output='';const collect=(chunk:Buffer)=>{output=(output+String(chunk)).slice(-4000);};
 child.stdout.on('data',collect);child.stderr.on('data',collect);
 const origin=await new Promise<string>((accept,reject)=>{
  const timer=setTimeout(()=>reject(Error('Fixture startup timeout '+output)),30000);
  child.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture exited '+output));});
  child.stdout.on('data',()=>{
   const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);
   if(match){clearTimeout(timer);accept(match[0]);}
  });
 });
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
 t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const baseline=requirements(), sha='a'.repeat(40), commit='https://github.com/Nirvana-Chow/lifeos-app/commit/'+sha;
 const merged={scope:'delivery-merged',ref:commit,at:'2026-11-22T00:00:00Z'};
 const production={scope:'delivery-production-verified',ref:commit,at:'2026-11-23T00:00:00Z',
  resultHref:'https://lifeos.nirvanachow.com/personal?page=projects',
  verificationHref:`https://github.com/Nirvana-Chow/lifeos-app/blob/${sha}/docs/verification/fixture.md`};
 const specs=[
  ['planned',[]],['in_progress',[]],['planned',[merged]],['done',[merged,production]],['blocked',[]],['done',[]],
 ] as const;
 const items=specs.map(([state,evidence],index)=>{
  const id=`11111111-1111-4111-8111-${String(index+1).padStart(12,'0')}`;
  const title='Synthetic private requirement '+index;
  const requirement:Requirement={...baseline.requirements[0],id,title,status:'not_started',
   roadmap:undefined,evidence:[...evidence]};
  return {id,revision:1,sourceId:id,baselineBinding:null,baselineConflict:false,requirement,
   fields:{title,body:'',phaseId:baseline.roadmap!.phases[0].id,priority:'P2',plannedStartOn:null,plannedEndOn:null,
    workflow:{state,purpose:'',nextStep:''}}};
 });
 const config={ownerId:'overview-owner',ownerEmail:'fixture@example.test',spaceId:'overview-space',baseURL:origin,
  databaseName:'fixture',approval:'personal-manual-v1',allowedTypes:['todo','journal'],calendarEnabled:true,requirementsEnabled:true} as const;
 const repo=new MemoryPort();
 repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(row=>row.ownerId===owner));
 let writable=true, mode:'ok'|'truncated'|'wrong-space'|'denied'='ok', reads=0;
 const handler=createPersonalPlatformHandler({config,repository:repo,storageVerified:true,
  sessions:{read:async()=>({userId:config.ownerId,email:config.ownerEmail})},assertWritable:async()=>{if(!writable)throw Error('read only');}});
 async function seed(path:string,fields:unknown,key:string){
  const response=await handler(new Request(origin+'/api/platform/personal/'+path,{method:'POST',
   headers:{origin,host:new URL(origin).host,'content-type':'application/json','idempotency-key':key},
   body:JSON.stringify({spaceId:config.spaceId,confirmed:true,fields})}));
  const body=await response.json();
  assert.equal(response.status,201,JSON.stringify(body));
  return body.entry.id as string;
 }
 const day=dateInCalendarZone(new Date().toISOString(),'Asia/Shanghai'),tomorrow=shiftCalendarDate(day,1);
 const journalId=await seed('journal',{title:'合成日记近期',text:'合成日记正文不展示',occurredOn:day},'overview-journal');
 await seed('calendar',{title:'合成明日日程',text:'',occurredOn:null,personal:{type:'calendar',schemaVersion:1,calendarKind:'event',
  links:{project:null,domain:null,people:[]},schedule:{kind:'all-day',startDate:tomorrow,endDate:shiftCalendarDate(tomorrow,1)}}},'overview-calendar');
 await seed('calendar',{title:'合成已过期日程',text:'',occurredOn:null,personal:{type:'calendar',schemaVersion:1,calendarKind:'event',
  links:{project:null,domain:null,people:[]},schedule:{kind:'all-day',startDate:shiftCalendarDate(day,-1),endDate:day}}},'overview-past');
 writable=false;
 const beforeRows=structuredClone(repo.rows);
 let readsDisabled=false, emptySources=false;
 await page.route('**/api/platform/**',async route=>{
  assert.equal(route.request().method(),'GET');
  const url=new URL(route.request().url()),path=url.pathname;
  if(path.endsWith('/requirements/snapshot')){
   reads++;
   if(mode==='denied')return route.fulfill({status:403,json:{}});
   return route.fulfill({json:{scope:'full-current-requirements-snapshot',items,total:items.length,
    truncated:mode==='truncated',observedAt:'2026-11-25T00:00:00Z',baseline}});
  }
  if(readsDisabled&&(path.includes('/calendar')||path.endsWith('/journal/snapshot')))return route.fulfill({status:503,json:{}});
  const response=await handler(new Request(url,{headers:{host:url.host}}));
  const result=await response.json();
  if(mode==='wrong-space'&&path.endsWith('/personal/status'))result.spaceId='another-space';
  if(emptySources&&path.endsWith('/journal/snapshot')){result.items=[];result.total=0;}
  if(emptySources&&path.endsWith('/personal/calendar')){result.entries=[];result.total=0;}
  return route.fulfill({status:response.status,json:result});
 });
 await page.goto(origin+'/personal',{waitUntil:'domcontentloaded',timeout:70000});
 const card=page.getByRole('region',{name:'需求进度',exact:true});
 const count=(label:string)=>card.locator('dl > div').filter({has:page.getByText(label,{exact:true})}).locator('dd');
 for(const [label,value] of [['未开始','1'],['进行中','2'],['待上线验收','1'],['已上线','1'],['其中受阻','1'],['待核实','1']]){
  await expect(count(label)).toHaveText(value);
 }
 await expect(card.locator('time')).toHaveAttribute('datetime','2026-11-25T00:00:00Z');
 await expect(card.locator('time')).toContainText('08:00');
 await expect(card.getByText('Synthetic private requirement',{exact:false})).toHaveCount(0);
 assert.ok(await card.evaluate(el=>el.scrollWidth<=el.clientWidth));
 const tasks=page.getByRole('region',{name:'未完待办',exact:true});
 const schedule=page.getByRole('region',{name:'近期日程',exact:true});
 const thoughts=page.getByRole('region',{name:'最近思考',exact:true});
 await expect(tasks.getByText('待办示例 open',{exact:true})).toHaveCount(1);
 await expect(tasks.getByText(/待办示例 (done|cancelled)/)).toHaveCount(0);
 await expect(schedule.getByText('合成明日日程')).toBeVisible();
 await expect(schedule.getByText('合成已过期日程')).toHaveCount(0);
 await expect(schedule.getByText('Apple 日历尚未连接')).toBeVisible();
 await expect(schedule.getByRole('link',{name:'查看日程'})).toHaveAttribute('href','/personal/schedule');
 await expect(thoughts.getByRole('link',{name:'合成日记近期'})).toHaveAttribute('href','/personal/journal?record='+journalId);
 await expect(thoughts.getByRole('link',{name:'查看记录'})).toHaveAttribute('href','/personal/journal');
 await expect(thoughts.getByText('Memos 尚未接入')).toBeVisible();
 await expect(thoughts.getByText('合成日记正文不展示')).toHaveCount(0);
 await expect(page.getByRole('region',{name:'生活维度',exact:true})).toHaveCount(0);
 await expect(page.getByRole('region',{name:'任务指标',exact:true})).toHaveCount(0);
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  const [calendar,notes]=await Promise.all([schedule.boundingBox(),thoughts.boundingBox()]);
  assert.ok(calendar&&notes&&(width===390?notes.y>calendar.y:notes.y===calendar.y));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 await page.setViewportSize({width:1440,height:900});
 if(process.env.LIFEOS_PROGRESS_CARD_SCREENSHOT)await card.screenshot({path:process.env.LIFEOS_PROGRESS_CARD_SCREENSHOT});
 for(const invalid of ['truncated','wrong-space','denied'] as const){
  const before=reads;mode=invalid;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(card.getByText('需求进度暂不可用')).toBeVisible();
  await expect(card.locator('dd')).toHaveCount(0);
  if(invalid==='wrong-space')assert.equal(reads,before);
 }
 mode='ok';
 await card.getByRole('button',{name:'查看全部需求'}).click();
 await expect(page).toHaveURL(/\/personal\?page=requirements$/);
 await expect(page.locator('[data-requirements-page]')).toBeVisible();
 await page.goto(origin+'/personal?empty=1',{waitUntil:'domcontentloaded',timeout:70000});
 emptySources=true;
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(tasks.getByText('暂无未完待办')).toBeVisible();
 await expect(schedule.getByText('未来 7 天暂无已读取的日程')).toBeVisible();
 await expect(thoughts.getByText('暂无日记')).toBeVisible();
 readsDisabled=true;
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(schedule.getByText('近期日程暂不可用')).toBeVisible();
 await expect(thoughts.getByText('日记暂不可用')).toBeVisible();
 assert.deepEqual(repo.rows,beforeRows);
 const before=reads;
 await page.goto(origin+'/personal?guest=1',{waitUntil:'domcontentloaded',timeout:70000});
 await expect(card).toHaveCount(0);
 assert.equal(reads,before);
});
