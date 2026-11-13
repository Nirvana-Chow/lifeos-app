import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {storageReviewResponse} from '../app/personal/storage-review/response.ts';
import {handleStorageReviewRequest} from '../src/storage-review/http.ts';
import {StorageReviewService} from '../src/storage-review/service.ts';
import {MemoryPort} from './helpers/platform.ts';
import type {PlatformRepository,Transaction} from '../src/platform/contracts.ts';

test('OPT-IN storage desktop ledger preserves conflict input and same-origin server readback',{
 skip:process.env.RUN_STORAGE_REVIEW_BROWSER_TESTS!=='1'&&'Requires native Chrome and isolated synthetic HTTP fixture',timeout:90_000,
},async t=>{
 const memory=new MemoryPort(),owner='synthetic-owner';
 const repository=new Proxy(memory as PlatformRepository,{get(target,key,receiver){
  if(key!=='transaction')return Reflect.get(target,key,receiver);
  return <T>(recordOwner:string,commandKey:string,run:(tx:Transaction)=>Promise<T>)=>memory.transaction(recordOwner,commandKey,tx=>run({...tx,lockRecordIdentity:async()=>{}}));
 }});
 const service=new StorageReviewService(repository,{ownerId:owner,spaceId:'synthetic-space'});
 const checklist={schema:1 as const,revision:'synthetic-ledger-v1',context:{summary:'Synthetic fixture only · no personal records'},items:[
  ...['S-001','S-002','S-003'].map(id=>({id,title:'合成资料 Synthetic archive '+id,body:'已核实空间 2 GiB；仅合成证据。长说明用于核对大屏信息层次、换行与手机阅读。'.repeat(3),question:'保留、删除候选或暂缓？',group:id==='S-003'?'合成照片':'合成资料',kind:'folder' as const,status:'pending' as const})),
  ...['processed','protected'].map((status,index)=>({id:'S-00'+(index+4),title:'合成只读资料',body:'空间未知，不推断大小',question:'',group:'合成资料',kind:'file' as const,status:status as 'processed'|'protected'})),
 ]};
 await service.saveChecklist(owner,{expectedRevision:null,checklist},'synthetic-ledger-create');
 let conflict=false,failRead=false;const patches:any[]=[];
 const server=createServer(async(req,res)=>{
  try{
   const url=origin+(req.url??'/');let response:Response;
   if(req.url==='/personal/storage-review')response=await storageReviewResponse(async()=>({id:owner}));
   else {
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value);
    const request=new Request(url,{method:req.method,headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})});
    if(req.method==='PATCH'){
     const input=JSON.parse(Buffer.concat(chunks).toString());patches.push(input);
     if(conflict){conflict=false;const current=await service.get(owner);await service.saveDecision(owner,{...input,expectedRevision:current!.revision,decision:'defer'},'synthetic-concurrent-write-'+current!.revision);}
    }
    if(req.method==='GET'&&failRead)response=Response.json({error:'synthetic-offline'},{status:503});
    else response=(await handleStorageReviewRequest(request,{ownerId:owner,baseURL:origin,service,assertOwner:async()=>{},assertWritable:async()=>{}}))!;
   }
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){const status=error&&typeof error==='object'&&'status'in error?Number(error.status):500;res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({error:'synthetic-request-error'}));}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();assert.ok(address&&typeof address==='object');const origin='http://127.0.0.1:'+address.port;
 t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
 t.after(()=>browser.close());
 const errors:string[]=[];const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(5000);
 const capture=process.env.STORAGE_REVIEW_CAPTURE_DIR;if(capture)await mkdir(capture,{recursive:true});
 for(const width of [1920,1365,390]){
  await page.setViewportSize({width,height:900});await page.goto(origin+'/personal/storage-review');
  await expect(page.locator('.row')).toHaveCount(5);await expect(page.locator('#sync-state')).toHaveText('LifeOS 已保存清单');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await expect(page.locator('.body').first()).toContainText('已核实空间 2 GiB');
  assert.ok(await page.locator('.readonly').first().evaluate(node=>node.getBoundingClientRect().width)>=100,'read-only labels stay in the content column on mobile');
  if(capture)await page.screenshot({path:capture+'/storage-'+width+'.png',fullPage:true});
 }
 for(const id of ['S-004','S-005'])await expect(page.locator(`[data-id="${id}"] .choices`)).toHaveCount(0);
 await page.selectOption('#group-filter','合成照片');await expect(page.locator('.row')).toHaveCount(1);await page.selectOption('#group-filter','');
 await page.fill('#search','S-002');await expect(page.locator('.row')).toHaveCount(1);await page.fill('#search','');
 const row=page.locator('[data-id="S-001"]');
 for(const decision of ['keep','trash','defer']){
  await row.locator(`label:has(input[value="${decision}"])`).click();await expect(page.locator('#notice')).toHaveText('决定已保存，并已读回 LifeOS。');await expect(row.locator('input:checked')).toHaveCount(1);
 }
 await page.selectOption('#filter','selected');await expect(page.locator('.row')).toHaveCount(1);await page.selectOption('#filter','pending');await expect(page.locator('.row')).toHaveCount(2);await page.selectOption('#filter','all');
 await row.getByRole('button',{name:'撤销决定'}).click();await expect(row.locator('input:checked')).toHaveCount(0);
 conflict=true;await row.locator('label:has(input[value="keep"])').click();await expect(page.locator('#pending-input')).toBeVisible();await expect(page.locator('#pending-description')).toContainText('本次输入「留」');await expect(row.locator('input[value="defer"]')).toBeChecked();
 const count=patches.length,beforeRetry=await service.get(owner);await page.locator('#retry-decision').click();await expect(page.locator('#pending-input')).toBeHidden();await expect(row.locator('input[value="keep"]')).toBeChecked();assert.equal(patches.length,count+1);assert.equal(patches.at(-1).expectedRevision,beforeRetry!.revision);assert.equal(patches.at(-1).id,'S-001');assert.equal(patches.at(-1).checklistRevision,checklist.revision);
 conflict=true;await row.locator('label:has(input[value="trash"])').click();await expect(page.locator('#pending-input')).toBeVisible();const beforeCancel=patches.length;await page.locator('#discard-decision').click();assert.equal(patches.length,beforeCancel);await expect(row.locator('input[value="defer"]')).toBeChecked();
 failRead=true;await row.locator('label:has(input[value="keep"])').click();await expect(page.locator('#pending-input')).toBeVisible();await expect(page.locator('#retry-decision')).toBeDisabled();await expect(page.locator('#sync-state')).toContainText('保存未确认');failRead=false;
 const beforeReadback=patches.length;await page.locator('#open-server').click();await expect(page.locator('#pending-input')).toBeVisible();await page.locator('#retry-decision').click();assert.equal(patches.length,beforeReadback,'a confirmed matching GET must not repeat an already successful write');await expect(page.locator('#pending-input')).toBeHidden();await expect(row.locator('input[value="keep"]')).toBeChecked();
 const independent=await browser.newContext();const reader=await independent.newPage();await reader.goto(origin+'/personal/storage-review');await expect(reader.locator('[data-id="S-001"] input[value="keep"]')).toBeChecked();await independent.close();
 assert.deepEqual(errors,[]);assert.ok(patches.every(input=>input.id==='S-001'));console.log('STORAGE_SYNTHETIC_BROWSER_PASS '+JSON.stringify({widths:[1920,1365,390],patches:patches.length,isolatedMemoryOnly:true}));
});
