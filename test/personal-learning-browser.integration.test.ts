import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium,expect} from '@playwright/test';

test('OPT-IN learning route saves a card and reloads independent durable review events and due time', {
  skip:process.env.RUN_LEARNING_BROWSER!=='1'&&'Requires isolated Next and Chromium', timeout:180000,
},async t=>{
  const source=resolve(import.meta.dirname,'..'), root=await mkdtemp(join(tmpdir(),'lifeos-learning-browser-'));
  const pgPort=process.env.LEARNING_FIXTURE_PG_PORT;
  const files=['app/layout.tsx','app/globals.css','app/theme.css','app/personal/layout.tsx','postcss.config.mjs',
    pgPort?'test/helpers/learning-pg.ts':'test/helpers/learning-sqlite.ts'];
  await Promise.all(['app/personal','app/login','test/helpers'].map(path=>mkdir(join(root,path),{recursive:true})));
  await Promise.all([
    ...files.map(path=>cp(join(source,path),join(root,path))),
    ...['src','app/personal/learning'].map(path=>cp(join(source,path),join(root,path),{recursive:true})),
    ...['node_modules','components'].map(path=>symlink(join(source,path),join(root,path))),
  ]);
  await writeFile(join(root,'app/login/page.tsx'),'export default function Page(){return <h1>Synthetic sign in</h1>}');
  await writeFile(join(root,'src/platform/runtime.ts'),`
    export async function readPlatformLoginCapability(){return {sessionDuration:false};}
    export async function readPlatformPagePrincipal(headers:Headers){
      return headers.get('cookie')?.includes('learning-fixture=')?{userId:'synthetic-owner'}:null;
    }
  `);
  await writeFile(join(root,'src/personal-learning/runtime.ts'),`
    import {PlatformError} from '../platform/domain';
    import {LearningService} from './service';
    ${pgPort?`
      import {learningFixturePool} from '../../test/helpers/learning-pg';
      import {PostgresLearningRepository,verifyLearningPostgres} from './postgres';
      const pool=learningFixturePool(process.env.LEARNING_FIXTURE_PG_PORT);
      const ready=verifyLearningPostgres(pool);
      const service=new LearningService(new PostgresLearningRepository(pool));
    `:`
      import {LearningSQLiteFixture} from '../../test/helpers/learning-sqlite';
      const ready=Promise.resolve();
      const service=new LearningService(new LearningSQLiteFixture(process.env.LEARNING_FIXTURE_DB!));
    `}
    export async function readLearningRuntime(request:Request){
      await ready;
      const baseURL='http://127.0.0.1:'+new URL(request.url).port;
      return {service,baseURL,authorize:async()=>{
        const value=request.headers.get('cookie')?.match(/(?:^|; )learning-fixture=(owner|foreign)(?:;|$)/)?.[1];
        if(!value)throw new PlatformError(401,'DENIED','Synthetic identity required');
        return {binding:{ownerId:'learning-fixture-'+value,spaceId:process.env.LEARNING_FIXTURE_SPACE!},writable:true};
      }};
    }
  `);
  const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{
    cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',
      LEARNING_FIXTURE_DB:join(root,'learning.sqlite'),
      LEARNING_FIXTURE_SPACE:'learning-browser-'+randomUUID(),...(pgPort?{LEARNING_FIXTURE_PG_PORT:pgPort}:{})},stdio:['ignore','pipe','pipe'],
  });
  const stopped=once(server,'exit');
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  t.after(async()=>{try{await browser?.close();}finally{if(server.exitCode===null)server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});}});
  let log='';server.stderr.on('data',chunk=>{log=(log+String(chunk)).slice(-5000);});
  const origin=await new Promise<string>((accept,reject)=>{
    const timer=setTimeout(()=>reject(Error(log||'Fixture startup timeout')),30000);
    server.once('exit',()=>{clearTimeout(timer);reject(Error(log||'Fixture exited'));});
    server.stdout.on('data',chunk=>{
      const address=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
      if(address){clearTimeout(timer);accept(address[0]);}
    });
  });
  browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
  const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai'});
  const page=await context.newPage();
  const entry=origin+'/personal/learning';
  const data=entry+'/data';
  await page.goto(entry,{waitUntil:'domcontentloaded',timeout:90000});
  await expect(page.getByRole('heading',{name:'Synthetic sign in'})).toBeVisible();
  assert.equal((await context.request.get(data)).status(),401);
  await context.addCookies([{name:'learning-fixture',value:'owner',url:origin}]);
  const commands:{key:string;body:string}[]=[];
  let denyReviewReceipt = false;
  let loseConflictResponse = false;
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==origin)return route.abort();
    if(url.pathname==='/api/platform/auth/get-session')return route.fulfill({json:{
      session:{mfaVerified:true,sessionDurationMode:'fixed',sessionDurationSeconds:3600,
        expiresAt:new Date(Date.now()+3600000).toISOString()},
    }});
    if(request.method()!=='POST'||url.pathname!=='/personal/learning/data')return route.continue();
    commands.push({key:request.headers()['idempotency-key'],body:request.postData()!});
    if(loseConflictResponse){
      loseConflictResponse=false;
      const competitor=await route.fetch({headers:{...request.headers(),'idempotency-key':'fixture-competing-'+randomUUID()}});
      assert.equal(competitor.status(),200);
      const stale=await route.fetch();
      assert.equal(stale.status(),409);
      await route.abort('failed');
      return;
    }
    if(!denyReviewReceipt)return route.continue();
    denyReviewReceipt=false;
    const result=await route.fetch();
    assert.equal(result.status(),200);
    await route.fulfill({status:403,json:{error:{code:'LEARNING_ACCESS_CHANGED',message:'Synthetic denial after commit'}}});
  });
  await page.goto(entry,{waitUntil:'domcontentloaded',timeout:90000});
  await expect(page.getByRole('heading',{name:'新建词卡'})).toBeVisible({timeout:30000});
  await page.getByLabel('词条').fill('   ');
  await page.getByLabel('释义').fill('Synthetic definition');
  await page.getByRole('button',{name:'创建词卡'}).click();
  await expect(page.getByRole('alert').filter({hasText:'请核对词卡或复习内容'})).toBeVisible();
  assert.equal(commands.length,0);
  await page.getByLabel('词条').fill('Synthetic word');
  await page.getByRole('button',{name:'创建词卡'}).click();
  const card=page.getByRole('article',{name:'Synthetic word'});
  await expect(card).toContainText('掌握度未知');
  await expect(card).not.toContainText('下次到期');
  assert.equal(commands.length,1);
  await card.getByRole('button',{name:'查看释义并复习'}).click();
  await expect(card).toContainText('Synthetic definition');
  denyReviewReceipt=true;
  await card.getByRole('button',{name:'记得',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'请重新验证词卡访问权限'})).toBeVisible();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('button',{name:'重试原请求'})).toHaveCount(0);
  // A different verified identity in this exact tab cannot see or retry the frozen request.
  await context.addCookies([{name:'learning-fixture',value:'foreign',url:origin}]);
  await page.reload({waitUntil:'domcontentloaded',timeout:90000});
  await expect(page.getByText('还没有词卡。',{exact:true})).toBeVisible({timeout:30000});
  await expect(page.getByRole('button',{name:'重试原请求'})).toHaveCount(0);
  assert.equal(commands.length,2);
  await context.addCookies([{name:'learning-fixture',value:'owner',url:origin}]);
  await page.reload({waitUntil:'domcontentloaded',timeout:90000});
  await expect(page.getByRole('alert').filter({hasText:'保存结果尚未确认'})).toBeVisible({timeout:30000});
  await page.getByRole('button',{name:'重试原请求'}).click();
  await expect(page.getByText('复习已保存。',{exact:true})).toBeVisible();
  await expect(card).toContainText('最近复习：记得');
  assert.deepEqual(commands[1],commands[2]);
  assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('lifeos.learning.pending.v1:')).length),0);
  await page.reload({waitUntil:'domcontentloaded',timeout:90000});
  await card.getByText('复习历史（1）',{exact:true}).click({timeout:30000});
  const firstAt=await card.locator('ol time').getAttribute('datetime');
  const firstDue=await card.locator('p time').getAttribute('datetime');
  assert.equal(Date.parse(firstDue!)-Date.parse(firstAt!),3*86400000);
  const firstSnapshot=await (await context.request.get(data)).json();
  const first=firstSnapshot.cards[0].history[0];
  assert.notEqual(first.id,first.cardId);
  assert.equal(first.scheduleVersion,'recall-ladder-v1');
  await page.setViewportSize({width:1365,height:900});
  await card.getByRole('button',{name:'查看释义并复习'}).click();
  await card.getByRole('button',{name:'记得',exact:true}).click();
  await expect(card.getByText('复习历史（2）',{exact:true})).toBeVisible();
  const result=await (await context.request.get(data)).json();
  const [older,newer]=result.cards[0].history;
  assert.deepEqual(older,first);
  assert.equal(newer.previousId,first.id);
  assert.notEqual(newer.id,first.id);
  assert.equal(Date.parse(result.cards[0].schedule.nextDueAt)-Date.parse(newer.reviewedAt),6*86400000);
  await page.reload({waitUntil:'domcontentloaded',timeout:90000});
  await expect(card.getByText('复习历史（2）',{exact:true})).toBeVisible({timeout:30000});
  loseConflictResponse=true;
  await card.getByRole('button',{name:'查看释义并复习'}).click();
  await card.getByRole('button',{name:'记得',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'保存结果尚未确认'})).toBeVisible();
  await page.reload({waitUntil:'domcontentloaded',timeout:90000});
  await page.getByRole('button',{name:'重试原请求'}).click({timeout:30000});
  await expect(page.getByRole('alert').filter({hasText:'复习记录已更新'})).toBeVisible();
  await expect(page.getByRole('button',{name:'重试原请求'})).toHaveCount(0);
  await expect(card.getByText('复习历史（3）',{exact:true})).toBeVisible();
  await expect(card.getByRole('button',{name:'查看释义并复习'})).toBeEnabled();
  assert.deepEqual(commands.at(-1),commands.at(-2));
  assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('lifeos.learning.pending.v1:')).length),0);
  const foreign=await browser.newContext();
  await foreign.addCookies([{name:'learning-fixture',value:'foreign',url:origin}]);
  assert.equal((await foreign.request.get(data+'?card='+first.cardId+'&review='+first.id)).status(),404);
  assert.deepEqual((await (await foreign.request.get(data)).json()).cards,[]);
});
