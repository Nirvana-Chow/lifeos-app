import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {expect,type Page} from '@playwright/test';
import {createManagedClientHandler} from '../../src/business-mcp-oauth/managed-client-http.ts';
import {readVerifiedOwnerSession} from '../../src/platform/auth.ts';
import {managedClientFixture,managedFixtureCallback} from './business-mcp-managed-client-fixture.ts';

export async function exerciseManagedCallback(root:string,origin:string,desktop:Page,mobile:Page){
 const f=await managedClientFixture(['personal-business:all','offline_access']);
 const api=createManagedClientHandler({auth:f.auth,platform:f.config,config:f.oauth,
  owner:headers=>readVerifiedOwnerSession(f.auth,f.config,headers),assertReady:async()=>{},withOwnerLock:async run=>run()});
 const path='/api/platform/business-mcp/client';
 const headers={host:new URL(f.config.baseURL).host,origin:f.config.baseURL,cookie:f.cookie,'content-type':'application/json'};
 const request=(method='GET',body?:string)=>api(new Request(f.config.baseURL+path,{method,headers,body}));
 async function snapshot(){
  const response=await request();assert.equal(response.status,200);
  await writeFile(join(root,'managed-setup.json'),await response.text());
 }
 const createId=randomUUID();
 assert.equal((await request('POST',JSON.stringify({callback:managedFixtureCallback,commandId:createId}))).status,201);
 await snapshot();

 const commands:{callback:string;commandId:string;expectedCommandId?:string}[]=[];
 let failure:'before'|'after'|null=null;
 for(const page of [desktop,mobile]){
  await page.route('**'+path,async route=>{
   const req=route.request(),post=req.method()==='POST',fault=post?failure:null;
   if(post){commands.push(req.postDataJSON());failure=null;}
   if(fault==='before')return route.fulfill({status:503,body:''});
   const response=await request(req.method(),req.postData()??undefined);
   if(post&&response.ok)await snapshot();
   if(fault==='after')return route.fulfill({status:503,body:''});
   return route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
  });
  await page.goto(origin+'/personal?page=settings&panel=general');
  const link=page.getByRole('link',{name:'ChatGPT 连接设置',exact:true});
  await expect(link).toHaveAttribute('href','/account/mcp');await link.click();
  await expect(page.getByRole('heading',{name:'已保存的配置'})).toBeVisible();
 }
 const change=(p:Page)=>p.getByRole('button',{name:'更换回调地址',exact:true});
 const field=(p:Page)=>p.getByLabel('新的 ChatGPT 回调地址',{exact:true});
 const save=(p:Page)=>p.getByRole('button',{name:'保存新回调地址',exact:true});
 const check=(p:Page)=>p.getByRole('button',{name:'核对保存结果',exact:true});
 const status=(p:Page)=>p.getByRole('status').filter({hasText:/回调地址|保存结果|最新配置/});
 const second=managedFixtureCallback+'2',third=managedFixtureCallback+'3';

 await change(desktop).focus();await desktop.keyboard.press('Enter');
 await expect(field(desktop)).toBeFocused();await field(desktop).fill(third);
 await desktop.getByRole('button',{name:'取消更换'}).click();
 await expect(change(desktop)).toBeFocused();assert.equal(commands.length,0);
 await change(desktop).click();await field(desktop).fill(third);

 await change(mobile).click();await field(mobile).fill(second);
 failure='after';await save(mobile).click();
 await expect(status(mobile)).toContainText('保存结果未确认');
 await check(mobile).click();await expect(status(mobile)).toContainText('回调地址已更换');
 assert.equal(commands.length,1);
 assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 await mobile.reload();await expect(mobile.getByText('当前 ChatGPT 回调地址：'+second,{exact:true})).toBeVisible();

 await save(desktop).click();await check(desktop).click();
 await desktop.getByRole('button',{name:'放弃旧请求，使用最新配置'}).click();
 assert.equal(commands.length,2);assert.equal(commands[1].expectedCommandId,createId);
 await expect(desktop.getByText('当前 ChatGPT 回调地址：'+second,{exact:true})).toBeVisible();

 await change(desktop).click();await field(desktop).fill(third);
 failure='before';await save(desktop).click();await expect(status(desktop)).toContainText('保存结果未确认');
 desktop.once('dialog',dialog=>dialog.accept());
 await desktop.reload();await check(desktop).click();
 await desktop.getByRole('button',{name:'使用原请求重试'}).click();
 await expect(status(desktop)).toContainText('回调地址已更换');
 assert.deepEqual(commands[3],commands[2]);assert.equal(commands[2].expectedCommandId,commands[0].commandId);
 await desktop.reload();await expect(desktop.getByText('当前 ChatGPT 回调地址：'+third,{exact:true})).toBeVisible();
 await desktop.getByRole('link',{name:'返回设置'}).click();
 await expect(desktop).toHaveURL(origin+'/personal?page=settings&panel=general');
}
