import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {chromium,devices,expect,type Browser,type BrowserServer} from '@playwright/test';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {MemoryPort} from './helpers/platform.ts';
import {createArkTaskTagSuggestionProvider} from '../src/personal-task-tag-suggestion/ark-provider.ts';
import {taskTagSuggestionPath,taskTagBindingHeader} from '../src/personal-task-tag-suggestion/contract.ts';
import {PersonalService,personalEntryType} from '../src/personal-candidate/service.ts';
import type {PersonalConfig,PersonalType} from '../src/personal-candidate/config.ts';
import type {PublicEntry} from '../src/platform/contracts.ts';
import {cleanupAuthThemeFixture,trackAuthThemeProcess,type FixtureProcess} from './helpers/auth-theme-fixture-lifecycle.ts';

test('OPT-IN suggestions on the real task detail stage only verified labels and leave writes to Save',{
 skip:process.env.RUN_TASK_TAG_DETAIL_BROWSER_TESTS!=='1'&&'Requires an isolated Next fixture and native Chromium',timeout:260_000,
},async()=>{
 const source=resolve(import.meta.dirname,'..'),root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-task-tag-editor-'));
 const owner={id:'synthetic-expand-owner',email:'phone-task@example.invalid'};
 const sessionCookie='lifeos-tag-detail-fixture';
 const hasSession=(headers:Headers)=>headers.get('cookie')?.split(';').some(part=>part.trim()===sessionCookie+'=owner')===true;
 let server:FixtureProcess|undefined,browserProcess:FixtureProcess|undefined,browserServer:BrowserServer|undefined,browser:Browser|undefined;
 try{
  await mkdir(join(root,'app/personal'),{recursive:true});
  await mkdir(join(root,'app/login'),{recursive:true});
  await writeFile(join(root,'app/login/page.tsx'),'export default function Page(){return <h1>合成登录</h1>}');
  await Promise.all([
   cp(join(source,'src'),join(root,'src'),{recursive:true}),
   ...['layout.tsx','globals.css','theme.css','personal/page.tsx','personal/layout.tsx','personal/error.tsx'].map(file=>cp(join(source,'app',file),join(root,'app',file))),
   cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
   symlink(join(source,'node_modules'),join(root,'node_modules')),symlink(join(source,'components'),join(root,'components')),
  ]);
  await writeFile(join(root,'next.config.mjs'),'export default {devIndicators:false};\n');
  await writeFile(join(root,'src/platform/runtime.ts'),`
export const readPlatformPagePrincipal=async(headers:Headers)=>
 headers.get('cookie')?.split(';').some(part=>part.trim()==='${sessionCookie}=owner')?{userId:'${owner.id}'}:null;
export const readPlatformPasswordCapability=async()=>false;
export const readPlatformLoginCapability=async()=>({sessionDuration:false});
`);
  const child=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{
   cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],detached:true,
  });
  server=trackAuthThemeProcess(child,true);
  child.stderr.resume();
  const origin=await new Promise<string>((accept,reject)=>{
   const timer=setTimeout(()=>reject(Error('Synthetic Next fixture startup timeout')),30_000);
   child.once('exit',()=>{clearTimeout(timer);reject(Error('Synthetic Next fixture exited'));});
   child.once('error',error=>{clearTimeout(timer);reject(error);});
   child.stdout.on('data',chunk=>{
    const url=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if(url){clearTimeout(timer);accept(url);}
   });
  });
  browserServer=await chromium.launchServer({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH,host:'127.0.0.1'});
  browserProcess=trackAuthThemeProcess(browserServer.process());
  browser=await chromium.connect(browserServer.wsEndpoint());
  let releaseSdk:(()=>void)|undefined;
  const model={provider:'volcengine-ark',baseURL:'https://ark.cn-beijing.volces.com/api/v3',model:'synthetic-label-model',
   dataScope:'current-message-only',monthlyBudgetMinor:null};
  const title='合成建议待办',note='合成正文，仅在选择发送后交给隔离输运';
  const completion=(matches:number[])=>Response.json({id:'synthetic-label-output',object:'chat.completion',created:1,model:model.model,
   choices:[{index:0,message:{role:'assistant',content:JSON.stringify({matches})},finish_reason:'stop'}],
   usage:{prompt_tokens:20,completion_tokens:5,total_tokens:25}});
  for(const width of [1365,390]){
   const page=await browser.newPage(width===1365?{viewport:{width,height:800}}:{...devices['iPhone 13'],viewport:{width,height:740}});
   await page.context().addCookies([{name:sessionCookie,value:'owner',url:origin,httpOnly:true,sameSite:'Lax'}]);
   const ownerId=owner.id,spaceId='synthetic-task-tag-space',otherSpace='synthetic-task-different-space';
   const config:PersonalConfig={ownerId,ownerEmail:owner.email,spaceId,baseURL:origin,databaseName:'lifeos_platform_test_local',
    allowedTypes:['todo','topic'],approval:'personal-manual-v1',transport:'ssh-loopback'};
   const repository=Object.assign(new MemoryPort(),{
    async readTaskWorkspaceSnapshot(verifiedOwner:string,verifiedSpace:string,types:readonly string[]){
     return structuredClone([...repository.rows.values()].filter(row=>row.ownerId===verifiedOwner&&types.includes(personalEntryType(row,verifiedSpace)??'')));
    },
   });
   repository.readCurrentSnapshot=async owner=>structuredClone([...repository.rows.values()].filter(row=>row.ownerId===owner));
   const service=new PersonalService(repository,config);
   const saveFixture=(type:PersonalType,fields:object,key:string)=>service.mutate(ownerId,type,null,{spaceId,confirmed:true,fields},key);
   const reference=(entry:PublicEntry)=>({id:entry.id,sourceId:entry.source.id,revision:entry.revision});
   const makeTopic=(name:string,key:string)=>saveFixture('topic',{title:name,text:'合成标签私有说明',occurredOn:null,personal:{type:'topic'}},key);
   const alphaName='合成建议甲',betaName='合成候选乙',manualName='合成手动标签';
   const alpha=reference((await makeTopic(alphaName,'synthetic-topic-alpha')).entry);
   const beta=reference((await makeTopic(betaName,'synthetic-topic-beta')).entry);
   const manual=reference((await makeTopic(manualName,'synthetic-topic-manual')).entry);
   const task=(await saveFixture('todo',{title,notes:note,status:'open',dueOn:null},'synthetic-task-tag-main')).entry;
   let permitted=false,authorized=true,activeSpace=spaceId,matches=[1],sdkCalls=0,holdNext=false,rejectSave=false,loseReadback=false;
   const inputs:{todoText:string;candidates:{number:number;name:string}[]}[]=[];
   const provider=createArkTaskTagSuggestionProvider(model,{mode:'synthetic-sdk-test',
    getSecret:async()=>'synthetic-tag-editor-transport-secret',
    assertCurrent:async()=>{if(!permitted)throw Error('Synthetic permission not enabled');},
    fetch:async(url,init)=>{
     assert.equal(String(url),model.baseURL+'/chat/completions');
     assert.equal(init?.method,'POST');
     const body=JSON.parse(String(init?.body));
     assert.equal(JSON.stringify(body).includes(ownerId),false);
     assert.equal(JSON.stringify(body).includes(spaceId),false);
     assert.equal(JSON.stringify(body).includes(alpha.id),false);
     assert.equal(JSON.stringify(body).includes('合成标签私有说明'),false);
     inputs.push(JSON.parse(body.messages.find((message:{role:string})=>message.role==='user').content));
     sdkCalls++;
     if(holdNext){holdNext=false;await new Promise<void>(resolve=>{releaseSdk=resolve;});}
     return completion(matches);
    },
   });
   const runtime=(scope:string)=>createPersonalPlatformHandler({repository,config:{...config,spaceId:scope},storageVerified:true,
    taskTagSuggestion:provider,sessions:{read:async headers=>authorized&&hasSession(headers)?{userId:ownerId,email:owner.email}:null},
    assertWritable:async()=>{}});
   const handlers=new Map([[spaceId,runtime(spaceId)],[otherSpace,runtime(otherSpace)]]);
   const rootPath='/api/platform/personal/';
   const detailPath=rootPath+'todo/'+task.id;
   const calls:{method:string;path:string;status:number;key:string|null;body?:unknown}[]=[],errors:string[]=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.route(/^https?:\/\/(?!127\.0\.0\.1:)/,route=>route.abort());
   await page.route('**/api/platform/**',async route=>{
    const request=route.request(),url=new URL(request.url()),method=request.method();
    const headers=new Headers(await request.allHeaders());headers.set('host',url.host);
    const body=request.postData()??undefined;
    const firstParty=headers.get(taskTagBindingHeader);
    if(url.pathname===taskTagSuggestionPath)assert.equal(firstParty,JSON.stringify([ownerId,spaceId]));
    let response:Response;
    if(method==='PATCH'&&rejectSave){
     rejectSave=false;
     response=Response.json({error:{code:'REFERENCE_CONFLICT'}},{status:409});
    }else if(method==='GET'&&url.pathname===detailPath&&loseReadback){
     loseReadback=false;
     response=Response.json({error:{code:'SYNTHETIC_READBACK_UNAVAILABLE'}},{status:503});
    }else response=await handlers.get(activeSpace)!(new Request(url,{method,headers,body}));
    calls.push({method,path:url.pathname,status:response.status,key:headers.get('idempotency-key'),...(body?{body:JSON.parse(body)}:{})});
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()}).catch(error=>{
     if(!/aborted|closed|handled/i.test(String(error)))throw error;
    });
   });
   const readTask=async()=>{
    const response=await handlers.get(spaceId)!(new Request(origin+detailPath,{headers:{host:new URL(origin).host,cookie:sessionCookie+'=owner'}}));
    assert.equal(response.status,200);return (await response.json()).entry;
   };
   const writes=()=>calls.filter(call=>call.path===detailPath&&call.method==='PATCH');
   const suggestions=()=>calls.filter(call=>call.path===taskTagSuggestionPath&&call.method==='POST');
   const panel=page.getByRole('group',{name:'建议标签',exact:true});
   const detail=page.getByRole('dialog',{name:'待办详情',exact:true});
   const manualLabels=detail.getByRole('group',{name:'选择已有标签',exact:true});
   const manualLabel=(name:string)=>manualLabels.getByRole('checkbox',{name,exact:true});
   const trigger=page.getByRole('button',{name:'查看待办详情：'+title,exact:true});
   const tap=async(locator:import('@playwright/test').Locator)=>{
    if(width===390)await locator.tap();else await locator.click();
   };
   const open=async()=>{
    await expect(trigger).toBeVisible({timeout:20000});await tap(trigger);
    await tap(detail.locator('summary').filter({hasText:'标签（可选）'}));
   };
   const select=async(id:string)=>panel.getByRole('combobox',{name:'本次候选标签'}).selectOption(id);
   const send=async()=>tap(panel.getByRole('button',{name:'发送并获取建议',exact:true}));
   const adopt=async()=>tap(panel.getByRole('button',{name:'采用所选标签',exact:true}));
   const save=async()=>tap(detail.getByRole('button',{name:'保存待办',exact:true}));
   const output=panel.getByRole('group',{name:'采用到待办草稿',exact:true});
   try{
    await page.goto(origin+'/personal?page=tasks',{waitUntil:'domcontentloaded',timeout:60000});
    await open();
    await expect(detail.getByText('标签建议尚未启用，可继续手动选标签。',{exact:true})).toBeVisible();
    await expect(panel).toHaveCount(0);
    await manualLabel(manualName).check();
    assert.equal(writes().length,0);
    await save();await expect(detail).toHaveCount(0);
    assert.deepEqual((await readTask()).draft.personal.topics,[manual]);
    assert.equal(suggestions().length,0);assert.equal(sdkCalls,0);

    permitted=true;
    await open();
    await expect(panel).toBeVisible();
    assert.equal(await panel.getByRole('textbox',{name:'本次待办文字',exact:true}).inputValue(),title+'\n'+note);
    await expect(panel.getByRole('button',{name:'发送并获取建议',exact:true})).toBeDisabled();
    await select(alpha.id);await select(beta.id);
    assert.equal(suggestions().length,0);
    await send();
    await expect(output.getByRole('checkbox',{name:alphaName,exact:true})).toBeChecked();
    await expect(output.getByRole('checkbox',{name:betaName,exact:true})).not.toBeChecked();
    assert.deepEqual(inputs[0],{todoText:title+'\n'+note,candidates:[{number:1,name:alphaName},{number:2,name:betaName}]});
    await tap(panel.getByRole('button',{name:'取消建议',exact:true}));
    await expect(output).toHaveCount(0);
    await expect(manualLabel(alphaName)).not.toBeChecked();
    assert.equal(writes().length,1);

    matches=[];
    await send();await expect(panel.getByText('本次没有匹配的标签。',{exact:true})).toBeVisible();
    await expect(output).toHaveCount(0);

    matches=[1];
    await send();
    await output.getByRole('checkbox',{name:alphaName,exact:true}).uncheck();
    await output.getByRole('checkbox',{name:betaName,exact:true}).check();
    await adopt();
    await expect(panel.getByText('已加入草稿。请在待办中确认后保存。',{exact:true})).toBeVisible();
    await expect(manualLabel(betaName)).toBeChecked();
    await expect(manualLabel(manualName)).toBeChecked();
    assert.equal(writes().length,1);
    assert.deepEqual((await readTask()).draft.personal.topics,[manual]);
    rejectSave=true;
    await save();
    await expect(detail.getByRole('alert')).toContainText('关联版本冲突');
    await expect(manualLabel(betaName)).toBeChecked();
    assert.deepEqual((await readTask()).draft.personal.topics,[manual]);

    loseReadback=true;
    await save();
    const recover=detail.getByRole('button',{name:'重试同一请求',exact:true});
    await expect(recover).toBeVisible();
    await expect(manualLabel(betaName)).toBeChecked();
    assert.deepEqual((await readTask()).draft.personal.topics,[manual,beta]);
    let patches=writes();
    assert.deepEqual(patches.map(call=>call.status),[200,409,200]);
    await tap(recover);await expect(detail).toHaveCount(0);
    patches=writes();
    assert.equal(patches[2].key,patches[3].key);
    assert.deepEqual(patches[2].body,patches[3].body);
    assert.deepEqual((await readTask()).draft.personal.topics,[manual,beta]);
    assert.equal((await readTask()).revision,3);
    assert.ok(calls.some(call=>call.path===detailPath&&call.method==='GET'&&call.status===200));

    await open();await select(alpha.id);await send();await expect(output).toBeVisible();
    permitted=false;
    await adopt();
    await expect(panel.getByText('未能核对当前权限或标签版本，请刷新后重试。',{exact:true})).toBeVisible();
    await expect(manualLabel(alphaName)).not.toBeChecked();
    permitted=true;
    await send();await expect(output).toBeVisible();
    await service.mutate(ownerId,'topic',alpha.id,{spaceId,confirmed:true,expectedRevision:alpha.revision,
     fields:{title:alphaName,text:'合成新版本',occurredOn:null,personal:{type:'topic'}}},'synthetic-topic-changed');
    await adopt();
    await expect(panel.getByText('未能核对当前权限或标签版本，请刷新后重试。',{exact:true})).toBeVisible();
    await expect(manualLabel(alphaName)).not.toBeChecked();
    assert.equal(writes().length,4);

    // A tab that is still showing the old workspace must fail before SDK dispatch.
    activeSpace=otherSpace;
    const beforeSwitch=sdkCalls;
    await send();
    await expect(panel.getByText('未能取得标签建议，可继续手动选标签。',{exact:true})).toBeVisible();
    assert.equal(suggestions().at(-1)?.status,403);
    assert.equal(sdkCalls,beforeSwitch);
    await page.reload({waitUntil:'domcontentloaded'});
    await expect(trigger).toHaveCount(0);
    await expect(panel).toHaveCount(0);
    activeSpace=spaceId;

    await page.reload({waitUntil:'domcontentloaded'});await open();await select(alpha.id);
    holdNext=true;const beforeRevoked=sdkCalls;await send();
    await expect.poll(()=>sdkCalls).toBe(beforeRevoked+1);
    authorized=false;releaseSdk!();releaseSdk=undefined;
    await expect(panel.getByText('未能取得标签建议，可继续手动选标签。',{exact:true})).toBeVisible();
    await expect(output).toHaveCount(0);
    assert.equal(suggestions().at(-1)?.status,401);
    authorized=true;

    holdNext=true;const beforeCancel=sdkCalls;await send();
    await expect.poll(()=>sdkCalls).toBe(beforeCancel+1);
    await tap(panel.getByRole('button',{name:'取消建议',exact:true}));
    releaseSdk!();releaseSdk=undefined;
    await expect(panel.getByText('已取消本次建议。',{exact:true})).toBeVisible();
    await expect(output).toHaveCount(0);
    await expect(manualLabel(alphaName)).not.toBeChecked();
    assert.equal(writes().length,4);
    assert.equal((await readTask()).revision,3);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);
    console.log('TASK_TAG_DETAIL_PASS '+JSON.stringify({width,lockedManual:true,explicitSdk:true,noMatch:true,reselected:true,
     cancelled:true,staleTopic:true,wrongSpace:true,revoked:true,saveRejected:true,failedReadbackSameKey:true,revision:3,syntheticSdkCalls:sdkCalls}));
   }finally{
    releaseSdk?.();releaseSdk=undefined;
    await page.close();
   }
  }
 }finally{await cleanupAuthThemeFixture({root,browser,browserServer,browserProcess,server});}
});
