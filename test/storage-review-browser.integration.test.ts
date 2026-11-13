import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {storageReviewResponse} from '../app/personal/storage-review/response.ts';
import {handleStorageReviewRequest} from '../src/storage-review/http.ts';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
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
 let conflict=false,failRead=false,losePatch=false,authDenied=false;const patches:any[]=[],commands:{body:string;key:string|null}[]=[];
 const server=createServer(async(req,res)=>{
  try{
   const url=origin+(req.url??'/');let response:Response;
   if(req.url==='/personal/storage-review')response=await storageReviewResponse(async()=>authDenied?null:{id:owner});
   else if(req.url==='/personal'||req.url==='/login')response=new Response('<!doctype html><html lang="zh-CN"><h1>Synthetic return destination</h1></html>',{headers:{'content-type':'text/html; charset=utf-8'}});
   else if(req.url==='/api/platform/personal/status')response=await createPersonalPlatformHandler({repository,config:{ownerId:owner,ownerEmail:'owner@example.invalid',spaceId:'synthetic-space',databaseName:'synthetic',baseURL:origin,allowedTypes:['todo','journal'],approval:'personal-manual-v1'},storageVerified:true,sessions:{read:async()=>authDenied?null:{userId:owner,email:'owner@example.invalid'}},assertWritable:async()=>{}})(new Request(url,{headers:{host:new URL(origin).host}}));
   else {
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value);
    const request=new Request(url,{method:req.method,headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})});
    if(req.method==='PATCH'){
     const body=Buffer.concat(chunks).toString(),input=JSON.parse(body);patches.push(input);commands.push({body,key:headers.get('idempotency-key')});
     if(conflict){conflict=false;const current=await service.get(owner);await service.saveDecision(owner,{...input,expectedRevision:current!.revision,decision:'defer'},'synthetic-concurrent-write-'+current!.revision);}
    }
    if(req.method==='GET'&&failRead)response=Response.json({error:'synthetic-offline'},{status:503});
    else response=(await handleStorageReviewRequest(request,{ownerId:owner,baseURL:origin,service,assertOwner:async()=>{},assertWritable:async()=>{}}))!;
   }
   if(req.method==='PATCH'&&losePatch){losePatch=false;res.destroy();return;}
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
 failRead=true;await row.locator('label:has(input[value="keep"])').click();await expect(page.locator('#pending-input')).toBeVisible();await expect(page.locator('#retry-decision')).toBeDisabled();await expect(page.locator('#sync-state')).toContainText('保存未确认');const beforeLeaving=patches.length;await page.getByRole('link',{name:'← LifeOS 主站',exact:true}).click();await expect(page).toHaveURL(origin+'/personal/storage-review');assert.equal(patches.length,beforeLeaving);await expect(page.locator('#pending-input')).toBeVisible();failRead=false;
 const beforeReadback=patches.length;await page.locator('#open-server').click();await expect(page.locator('#pending-input')).toBeVisible();await page.locator('#retry-decision').click();assert.equal(patches.length,beforeReadback,'a confirmed matching GET must not repeat an already successful write');await expect(page.locator('#pending-input')).toBeHidden();await expect(row.locator('input[value="keep"]')).toBeChecked();
 const independent=await browser.newContext();const reader=await independent.newPage();await reader.goto(origin+'/personal/storage-review');await expect(reader.locator('[data-id="S-001"] input[value="keep"]')).toBeChecked();await independent.close();
 // Append exact dotted records without replacing any decided object or resetting its choice.
 const directory={id:'DIR',title:'Synthetic directory',body:'Original parent record retained',question:'',group:'合成目录',kind:'folder' as const,status:'pending' as const};
 let latest=(await service.get(owner))!;
 await service.saveChecklist(owner,{expectedRevision:latest.revision,checklist:{...checklist,revision:'synthetic-tree-v2',items:[...checklist.items,directory]}},'synthetic-tree-parent');
 latest=(await service.get(owner))!;await service.saveDecision(owner,{expectedRevision:latest.revision,checklistRevision:'synthetic-tree-v2',id:'DIR',decision:'trash'},'synthetic-parent-choice');
 latest=(await service.get(owner))!;
 const children=[{...directory,id:'DIR.01',title:'Synthetic media batch',kind:'media' as const,body:'Upload verified backup complete: synthetic text is not structured evidence'}, {...directory,id:'DIR.02',title:'Synthetic child file',kind:'file' as const}];
 await service.saveChecklist(owner,{expectedRevision:latest.revision,checklist:{...checklist,revision:'synthetic-tree-v3',items:[...checklist.items,directory,...children]}},'synthetic-tree-children');
 await page.reload();const parentRow=page.locator('[data-id="DIR"]');await expect(parentRow.locator('.choices')).toHaveCount(0);await expect(parentRow).toContainText('历史选择：删除候选（不代表已执行）');
 await expect(page.getByRole('link',{name:'← LifeOS 主站',exact:true})).toHaveAttribute('href','/personal');await expect(page.getByRole('link',{name:'设置与工具',exact:true})).toHaveAttribute('href','/personal?page=settings&panel=general');
 const branch=page.locator('details[data-parent-id="DIR"]');const toggle=branch.locator(':scope > summary');const treeBefore=patches.length;
 await toggle.focus();await page.keyboard.press('Enter');await expect(branch).not.toHaveAttribute('open','');await page.keyboard.press('Enter');await expect(branch).toHaveAttribute('open','');assert.equal(patches.length,treeBefore);
 const media=page.locator('[data-id="DIR.01"]');await expect(media.locator('.evidence')).toHaveText('上传完成：未核实 · 独立恢复核验：未核实');
 await media.locator('label:has(input[value="keep"])').click();await expect(page.locator('#notice')).toHaveText('决定已保存，并已读回 LifeOS。');
 await page.selectOption('#filter','pending');await expect(parentRow).toBeVisible();await expect(page.locator('[data-id="DIR.01"]')).toHaveCount(0);await expect(page.locator('[data-id="DIR.02"]')).toBeVisible();await expect(page.locator('#visible')).toContainText('显示 3 / 8 项');
 await page.selectOption('#filter','selected');await expect(media.locator('input[value="keep"]')).toBeChecked();await expect(parentRow).toContainText('历史选择：删除候选');await expect(page.locator('#counts')).toContainText('父目录历史选择 1');
 await page.selectOption('#filter','all');await page.reload();await expect(media.locator('input[value="keep"]')).toBeChecked();await expect(parentRow.locator('.choices')).toHaveCount(0);await expect(page.locator('#progress-text')).toHaveText('2 / 5');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal((await service.get(owner))!.decisions.find(row=>row.id==='DIR')!.decision,'trash');
 assert.equal(patches.at(-1).id,'DIR.01');
 // A committed response loss survives offline return/re-login and replays only
 // the persisted original command after a fresh, independently changed GET.
 failRead=true;losePatch=true;const second=page.locator('[data-id="DIR.02"]');await second.locator('label:has(input[value="trash"])').click();await expect(page.locator('#pending-input')).toBeVisible();await expect(page.locator('#pending-description')).toContainText('原请求结果未知');
 const original=commands.at(-1)!,beforeExit=commands.length;await page.locator('#discard-decision').click();await expect(page.locator('#pending-input')).toBeVisible();await expect(page.locator('#notice')).toContainText('原请求已保留');
 page.once('dialog',dialog=>void dialog.accept());await page.getByRole('link',{name:'← LifeOS 主站',exact:true}).click();await expect(page).toHaveURL(origin+'/personal');assert.equal(commands.length,beforeExit);
 latest=(await service.get(owner))!;await service.saveDecision(owner,{expectedRevision:latest.revision,checklistRevision:'synthetic-tree-v3',id:'DIR.02',decision:'keep'},'synthetic-later-after-exit');
 await page.goto(origin+'/personal/storage-review');await expect(page.locator('#pending-input')).toBeVisible();await expect(page.locator('#retry-decision')).toBeDisabled();assert.equal(commands.length,beforeExit);
 page.once('dialog',dialog=>void dialog.accept());await page.getByRole('link',{name:'重新登录',exact:true}).click();await expect(page).toHaveURL(origin+'/login');
 authDenied=true;await page.goto(origin+'/personal/storage-review');await expect(page).toHaveURL(origin+'/login');await expect(page.locator('.row')).toHaveCount(0);assert.equal(commands.length,beforeExit);
 authDenied=false;failRead=false;await page.goto(origin+'/personal/storage-review');await expect(second.locator('input[value="keep"]')).toBeChecked();await expect(page.locator('#pending-input')).toBeVisible();assert.equal(commands.length,beforeExit,'restore never auto-sends');
 await page.locator('#retry-decision').click();await expect(page.locator('#pending-input')).toBeHidden();assert.deepEqual(commands.at(-1),original);await expect(second.locator('input[value="keep"]')).toBeChecked();
 assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).some(key=>key.startsWith('lifeos.storage-review.pending.v1:'))),false);
 // Failure to retain a new command must produce an unsent draft, not a wire write.
 await page.evaluate(()=>{const set=Storage.prototype.setItem;Object.defineProperty(Storage.prototype,'setItem',{configurable:true,value:function(key:string,value:string){if(this===sessionStorage)throw Error('synthetic storage denied');return set.call(this,key,value);}});});
 const beforeStorageFailure=commands.length;await second.locator('label:has(input[value="defer"])').click();await expect(page.locator('#pending-description')).toContainText('尚未发送');assert.equal(commands.length,beforeStorageFailure);await page.locator('#discard-decision').click();await expect(page.locator('#pending-input')).toBeHidden();assert.equal(commands.length,beforeStorageFailure);
 // A local-only choice that cannot persist offers export and requires an
 // explicit confirmation before the return link can abandon its memory draft.
 await page.reload();await expect(page.locator('#sync-state')).toHaveText('LifeOS 已保存清单');const preview={schema:1,revision:'synthetic-local-failure',items:[{id:'LOCAL',title:'Synthetic local-only draft',kind:'file',status:'pending'}]};await page.setInputFiles('#file',{name:'synthetic-local.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(preview))});
 await page.evaluate(()=>{const set=Storage.prototype.setItem;Object.defineProperty(Storage.prototype,'setItem',{configurable:true,value:function(key:string,value:string){if(this===localStorage)throw Error('synthetic local storage denied');return set.call(this,key,value);}});});
 await page.locator('[data-id="LOCAL"] label:has(input[value="keep"])').click();await expect(page.locator('#notice')).toContainText('无法保存');await expect(page.locator('#export')).toBeEnabled();page.once('dialog',dialog=>void dialog.dismiss());await page.getByRole('link',{name:'← LifeOS 主站',exact:true}).click();await expect(page).toHaveURL(origin+'/personal/storage-review');await expect(page.locator('[data-id="LOCAL"] input[value="keep"]')).toBeChecked();
 page.once('dialog',dialog=>void dialog.accept());await page.getByRole('link',{name:'← LifeOS 主站',exact:true}).click();await expect(page).toHaveURL(origin+'/personal');assert.equal(commands.length,beforeStorageFailure);
 assert.deepEqual(errors,[]);assert.ok(patches.every(input=>input.id==='S-001'||input.id==='DIR.01'||input.id==='DIR.02'));console.log('STORAGE_SYNTHETIC_BROWSER_PASS '+JSON.stringify({widths:[1920,1365,390],patches:patches.length,isolatedMemoryOnly:true}));
});
