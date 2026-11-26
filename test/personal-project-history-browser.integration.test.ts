import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,expect,type Locator} from '@playwright/test';

test('OPT-IN project history uses the saved revision on the owner detail route',{
 skip:process.env.RUN_PERSONAL_PROJECT_HISTORY_BROWSER!=='1'&&'Requires isolated Next and Chromium',
 timeout:180_000,
},async t=>{
 const source=resolve(import.meta.dirname,'..');
 const root=await mkdtemp(join(tmpdir(),'lifeos-project-revision-'));
 let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
 let server:ReturnType<typeof spawn>|undefined;
 let stopped:Promise<unknown>|undefined;
 t.after(async()=>{
  try{await browser?.close();}
  finally{if(server&&server.exitCode===null)server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});}
 });
 const probe=createServer();
 probe.listen(0,'127.0.0.1');
 await once(probe,'listening');
 const address=probe.address();
 assert.ok(address&&typeof address!=='string');
 const port=address.port;
 await new Promise<void>((done,reject)=>probe.close(error=>error?reject(error):done()));
 const origin='http://127.0.0.1:'+port,manifest=join(root,'ids.json');
 const title='合成项目修订',body='每一版的目标正文相同',nextStep='整理复核结果';
 const apiRoute='app/api/platform/[[...resource]]/route.ts';
 await Promise.all(['app/personal/edit','app/api/platform/[[...resource]]','test/helpers'].map(dir=>mkdir(join(root,dir),{recursive:true})));
 await Promise.all([
  ...['app/layout.tsx','app/globals.css','app/theme.css','app/personal/edit/page.tsx',apiRoute,'postcss.config.mjs','test/helpers/platform.ts'].map(file=>cp(join(source,file),join(root,file))),
  cp(join(source,'src'),join(root,'src'),{recursive:true}),
  ...['node_modules','components'].map(file=>symlink(join(source,file),join(root,file))),
 ]);
 await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
 // Keep Next's owner page and catch-all route. Only identity and storage are synthetic.
 await writeFile(join(root,'src/platform/runtime.ts'),`
  import {writeFile} from 'node:fs/promises';
  import {createPersonalPlatformHandler} from '../personal-candidate/runtime-http';
  import {PersonalService} from '../personal-candidate/service';
  import {MemoryPort} from '../../test/helpers/platform';

  const ownerId='synthetic-project-owner',spaceId='synthetic-project-space',ownerEmail='project@example.test';
  const config={ownerId,spaceId,ownerEmail,baseURL:${JSON.stringify(origin)},databaseName:'lifeos_platform_test_local',
   transport:'ssh-loopback',approval:'personal-manual-v1',allowedTypes:['todo','journal','project','domain','topic']} as const;
  const principal=(headers:Headers)=>headers.get('cookie')?.includes('project-fixture=owner')?{userId:ownerId,email:ownerEmail}:null;
  export const readPlatformPagePrincipal=async(headers:Headers)=>principal(headers);
  export const readPlatformPasswordCapability=async()=>false;

  async function prepare(){
   const repo=new MemoryPort();
   repo.readCurrentSnapshot=async owner=>[...repo.rows.values()].filter(row=>row.ownerId===owner);
   const repository=Object.assign(repo,{readTaskWorkspaceSnapshot:repo.readCurrentSnapshot});
   const personal=new PersonalService(repository,config);
   const add=async(type:'domain'|'topic'|'project'|'journal'|'todo',fields:unknown,key:string)=>
    (await personal.mutate(ownerId,type,null,{spaceId,confirmed:true,fields},key)).entry;
   const object=(title:string,type:string)=>({title,text:'合成资料',occurredOn:null,personal:{type}});
   const pin=(entry:{id:string;source:{id:string};revision:number})=>({id:entry.id,sourceId:entry.source.id,revision:entry.revision});
   const domain=pin(await add('domain',object('同名领域','domain'),'fixture-project-domain-a'));
   const duplicate=pin(await add('domain',object('同名领域','domain'),'fixture-project-domain-b'));
   const topic=pin(await add('topic',object('合成主题','topic'),'fixture-project-topic'));
   const fields={title:${JSON.stringify(title)},text:${JSON.stringify(body)},occurredOn:null,personal:{type:'project',stage:'idea',purpose:null,nextStep:'',domain,topics:[topic]}};
   const project=await add('project',fields,'fixture-project-main');
   const legacy=await add('project',{...fields,title:'合成旧项目',personal:{...fields.personal,domain:null,topics:[]}},'fixture-project-legacy');
   // The old wire representation omitted optional references. Its binding and body still validate.
   for(const old of [repo.rows.get(legacy.id),repo.historyRows.find(row=>row.id===legacy.id)]){
    const metadata=(old?.draft as {personal?:{domain?:unknown;topics?:unknown}})?.personal;
    if(metadata){delete metadata.domain;delete metadata.topics;}
   }
   const journal=await add('journal',{title:'合成日记',text:'原日记历史正文',occurredOn:null},'fixture-project-journal');
   const todo=await add('todo',{title:'合成待办',notes:'原待办历史正文',dueOn:null,status:'open'},'fixture-project-todo');
   await writeFile(${JSON.stringify(manifest)},JSON.stringify({project:project.id,legacy:legacy.id,journal:journal.id,todo:todo.id,domain,duplicate,topic}));
   const handler=(config:Parameters<typeof createPersonalPlatformHandler>[0]['config'])=>
    createPersonalPlatformHandler({config,repository,storageVerified:true,sessions:{read:async headers=>principal(headers)},assertWritable:async()=>{}});
   return {home:handler(config),other:handler({...config,spaceId:'synthetic-project-other-space'})};
  }
  const fixtureState=globalThis as typeof globalThis & {projectRevisionFixture?:ReturnType<typeof prepare>};
  export async function handlePlatformRequest(request:Request){
   const handlers=await (fixtureState.projectRevisionFixture??=prepare());
   const cookie=request.headers.get('cookie')??'';
   if(cookie.includes('project-fixture-history=denied')&&new URL(request.url).pathname.endsWith('/history')){
    const headers=new Headers(request.headers);headers.delete('cookie');
    return handlers.home(new Request(request,{headers}));
   }
   return (cookie.includes('project-fixture-space=other')?handlers.other:handlers.home)(request);
  }
 `);
 const fixture=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{
  cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],
 });
 server=fixture;stopped=once(fixture,'exit');
 let output='';
 fixture.stderr.on('data',chunk=>{output=(output+String(chunk)).slice(-5000);});
 await new Promise<void>((accept,reject)=>{
  const timer=setTimeout(()=>reject(Error(output||'Fixture startup timeout')),30_000);
  fixture.once('exit',()=>{clearTimeout(timer);reject(Error(output||'Fixture exited'));});
  fixture.stdout.on('data',chunk=>{if(String(chunk).includes(origin)){clearTimeout(timer);accept();}});
 });
 browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
 const page=await browser.newPage({viewport:{width:1365,height:900},timezoneId:'Asia/Shanghai'});
 page.setDefaultTimeout(15_000);
 const cookie=(name:string,value:string)=>page.context().addCookies([{name,value,url:origin}]);
 await cookie('project-fixture','owner');
 const status=await page.request.get(origin+'/api/platform/personal/status',{timeout:60_000});
 assert.equal(status.status(),200,(await status.text()).slice(0,300)+'\n'+output);
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const firstOverview=page.waitForResponse(reply=>reply.url().startsWith(origin+'/api/platform/personal/overview?'));
 await page.goto(origin+'/personal/edit?type=project',{waitUntil:'domcontentloaded',timeout:60_000});
 assert.equal((await firstOverview).status(),200);
 const ids=JSON.parse(await readFile(manifest,'utf8')) as {
  project:string;legacy:string;journal:string;todo:string;
  domain:{id:string;sourceId:string;revision:number};duplicate:{id:string;sourceId:string;revision:number};
  topic:{id:string;sourceId:string;revision:number};
 };
 const history=page.locator('section').filter({has:page.getByRole('heading',{name:'原文与更正历史',exact:true})});
 const revisionLabel=(revision:number)=>page.locator('summary').filter({hasText:new RegExp('^版本 '+revision+'$')});
 const open=async(revision:number)=>{
  const panel=history.locator('details').filter({has:revisionLabel(revision)});
  const summary=panel.locator('summary');
  if(!await panel.evaluate(node=>(node as HTMLDetailsElement).open))await summary.click();
  return panel;
 };
 const value=(panel:Locator,label:string)=>panel.locator('dt').filter({hasText:new RegExp('^'+label+'$')}).locator('xpath=following-sibling::dd[1]');
 const edit=(type:string,id:string)=>page.goto(origin+'/personal/edit?type='+type+'&id='+id,{waitUntil:'domcontentloaded',timeout:60_000});
 const save=async(revision:number)=>{
  const response=page.waitForResponse(r=>r.url()===origin+'/api/platform/personal/project/'+ids.project&&r.request().method()==='PATCH');
  await page.getByLabel('我已核对这一条内容，确认保存到本人空间。',{exact:true}).check();
  await page.getByRole('button',{name:'确认保存',exact:true}).click();
  const res=await response;
  assert.equal(res.status(),200);
  const receipt=await res.json();
  assert.equal(receipt.entry.revision,revision);
  assert.equal(receipt.entry.draft.text,body);
  assert.equal(receipt.duplicate,false);
  await expect(history.locator(revisionLabel(revision))).toBeVisible();
  return receipt.entry;
 };

 const projectPath=origin+'/api/platform/personal/project/'+ids.project;
 const projectResponse=await page.request.get(projectPath);
 const projectHistory=await page.request.get(projectPath+'/history?limit=50');
 assert.equal(projectResponse.status(),200,await projectResponse.text());
 assert.equal(projectHistory.status(),200,await projectHistory.text());
 assert.equal((await projectHistory.json()).items.length,1);
 const before=(await projectResponse.json()).entry;
 const statusAtPage:string[]=[];
 page.on('response',reply=>{if(reply.url().startsWith(origin+'/api/platform/personal/'))statusAtPage.push(reply.status()+' '+new URL(reply.url()).pathname);});
 await edit('project',ids.project);
 try{await expect(page.getByLabel('标题',{exact:true})).toHaveValue(title);}
 catch(error){t.diagnostic(JSON.stringify({requests:statusAtPage,status:await page.getByRole('status').allTextContents(),server:output}));throw error;}
 const initial=await open(1);
 // This acceptance fails on the baseline even when the body history is present.
 await expect(value(initial,'阶段')).toHaveText('想法');
 await expect(value(initial,'下一步')).toHaveText('未填写');
 await expect(value(initial,'领域引用')).toContainText(ids.domain.id);
 await expect(value(initial,'领域引用')).toContainText(ids.domain.sourceId);
 await expect(value(initial,'领域引用')).not.toContainText(ids.duplicate.id);
 await expect(value(initial,'主题引用')).toContainText(ids.topic.id);
 await expect(value(initial,'主题引用')).toContainText(ids.topic.sourceId);
 await page.getByLabel('阶段',{exact:true}).selectOption('active');
 const afterStage=await save(2);
 assert.deepEqual(afterStage.draft,{...before.draft,personal:{...before.draft.personal,stage:'active'}});
 assert.deepEqual(afterStage.source,before.source);
 await expect(value(await open(2),'阶段')).toHaveText('进行中');
 await expect(value(await open(2),'下一步')).toHaveText('未填写');
 await expect(value(await open(1),'阶段')).toHaveText('想法');

 await page.setViewportSize({width:390,height:844});
 await page.getByLabel('下一步',{exact:true}).fill(nextStep);
 const afterStep=await save(3);
 assert.deepEqual(afterStep.draft,{...afterStage.draft,personal:{...afterStage.draft.personal,nextStep}});
 assert.deepEqual(afterStep.source,before.source);
 for(const [revision,stage,step] of [[1,'想法','未填写'],[2,'进行中','未填写'],[3,'进行中',nextStep]] as const){
  const panel=await open(revision);
  await expect(value(panel,'阶段')).toHaveText(stage);
  await expect(value(panel,'下一步')).toHaveText(step);
  await expect(value(panel,'领域引用')).toContainText('修订 '+ids.domain.revision);
  await expect(value(panel,'证据引用')).toHaveText('未知');
  await expect(panel.getByText(body,{exact:true})).toBeVisible();
 }
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.reload({waitUntil:'domcontentloaded'});
 await expect(value(await open(3),'下一步')).toHaveText(nextStep);
 await edit('project',ids.legacy);
 const legacy=await open(1);
 await expect(value(legacy,'领域引用')).toHaveText('未知');
 await expect(value(legacy,'主题引用')).toHaveText('未知');
 await expect(value(legacy,'证据引用')).toHaveText('未知');

 // Both original history consumers retain the same response/body contracts.
 await edit('journal',ids.journal);
 const journal=await open(1);
 await expect(journal.getByText('原日记历史正文',{exact:true})).toBeVisible();
 await expect(journal.getByText('证据引用',{exact:true})).toHaveCount(0);
 const todoHistory=await page.request.get(origin+'/api/platform/personal/todo/'+ids.todo+'/history?limit=50');
 assert.equal(todoHistory.status(),200);
 assert.equal((await todoHistory.json()).items[0].draft.notes,'原待办历史正文');
 await edit('todo',ids.todo);
 await expect(page.getByRole('dialog',{name:'待办详情',exact:true}).getByLabel('正文',{exact:true})).toHaveValue('原待办历史正文');

 await edit('project',ids.project);
 await expect(value(await open(3),'下一步')).toHaveText(nextStep);
 await cookie('project-fixture-history','denied');
 await page.getByRole('button',{name:title,exact:true}).click();
 await expect(history).toHaveCount(0);
 await expect(page.getByText('本人会话或权限已变化，请重新核对。',{exact:true})).toBeVisible();
 await expect(page.getByText(nextStep,{exact:true})).toHaveCount(0);
 await page.context().clearCookies();
 await cookie('project-fixture','owner');
 await edit('project',ids.project);
 await expect(value(await open(3),'下一步')).toHaveText(nextStep);
 await cookie('project-fixture-space','other');
 await page.getByRole('button',{name:'重新核对状态',exact:true}).click();
 await expect(history).toHaveCount(0);
 await expect(page.getByText('身份或空间已变化，请重新核对后继续。',{exact:true})).toBeVisible();
 assert.equal((await page.request.get(origin+'/api/platform/personal/project/'+ids.project+'/history')).status(),404);
});
