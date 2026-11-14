import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium,expect} from '@playwright/test';
import {storageReviewResponse} from '../app/personal/storage-review/response.ts';
import {handleStorageReviewRequest} from '../src/storage-review/http.ts';
import {StorageReviewService} from '../src/storage-review/service.ts';
import {MemoryPort} from './helpers/platform.ts';
import {PlatformError} from '../src/platform/domain.ts';

test('OPT-IN original storage route saves notes, retains drafts/CAS/unknown and reads across browsers',{
 skip:process.env.RUN_STORAGE_REVIEW_NOTES_BROWSER_TESTS!=='1'&&'Requires actual Chrome and isolated synthetic HTTP fixture',timeout:90_000,
},async t=>{
 const memory=new MemoryPort(),transaction=memory.transaction.bind(memory),owner='synthetic-note-owner',space='synthetic-note-space';
 memory.transaction=(owner,key,run)=>transaction(owner,key,tx=>run({...tx,lockRecordIdentity:async()=>{}}));
 const service=new StorageReviewService(memory,{ownerId:owner,spaceId:space}),checklist={schema:1 as const,revision:'synthetic-browser-notes-v1',context:{summary:'Synthetic only'},items:['pending','processed','protected'].map((status,index)=>({id:'N-'+index,title:'Synthetic '+status,body:'Preserved original body',question:'',group:'Synthetic',kind:'file' as const,status:status as 'pending'|'processed'|'protected'}))};
 await service.saveChecklist(owner,{expectedRevision:null,checklist},'synthetic-browser-note-create');
 await service.saveDecision(owner,{expectedRevision:1,checklistRevision:checklist.revision,id:'N-0',decision:'keep'},'synthetic-browser-note-decision');
 let lose=false,offline=false,conflict=false,denied=false;
 const wire:{url:string;body:string;key:string|null}[]=[];
 const responseTrace:{method:string|undefined;status:number;path:string}[]=[];
 const server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url!,origin);let response:Response;
   if(url.pathname==='/personal/storage-review')response=await storageReviewResponse(async()=>denied?null:{id:owner});
   else if(url.pathname==='/personal'||url.pathname==='/login')response=new Response('Synthetic return page');
   else if(url.pathname==='/api/platform/personal/status')response=denied?Response.json({error:'denied'},{status:401}):Response.json({scope:'personal-manual-candidate',storageVerified:true,storageReviewEnabled:true,ownerId:owner,spaceId:space});
   else{
    const chunks:Buffer[]=[];for await(const part of req)chunks.push(Buffer.from(part));const body=Buffer.concat(chunks).toString();
    const headers=new Headers();for(const[k,v]of Object.entries(req.headers))if(v)headers.set(k,Array.isArray(v)?v.join(','):v);
    if(req.method==='PATCH'&&url.pathname.endsWith('/notes')){
     wire.push({url:url.pathname,body,key:headers.get('idempotency-key')});
     if(conflict){conflict=false;const command=JSON.parse(body);await service.saveNote(owner,{...command,note:'Concurrent synthetic note'},'synthetic-note-concurrent-'+wire.length);}
    }
    if(req.method==='GET'&&offline)response=Response.json({error:'synthetic-offline'},{status:503});
    else response=(await handleStorageReviewRequest(new Request(url,{method:req.method,headers,...(body?{body}:{})}),{ownerId:owner,baseURL:origin,service,assertOwner:async()=>{if(denied)throw new PlatformError(401,'OWNER_ONLY','Synthetic denial');},assertWritable:async()=>{}}))!;
    if(lose&&req.method==='PATCH'){lose=false;response=Response.json({error:'synthetic-lost-receipt'},{status:503});}
   }
   responseTrace.push({method:req.method,status:response.status,path:req.url!});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){if(!(e instanceof PlatformError))console.log('SYNTHETIC_SERVER_ERROR',e);res.writeHead(e instanceof PlatformError?e.status:500,{'content-type':'application/json'});res.end(JSON.stringify({error:e instanceof PlatformError?e.code:'synthetic-request-error'}));}
 });
 const origin='http://127.0.0.1:32141';await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(32141,'127.0.0.1',resolve);});
 t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 const page=await browser.newPage();page.setDefaultTimeout(5000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/personal/storage-review');await expect(page.locator('.row-note textarea')).toHaveCount(3);await expect(page.locator('#sync-state')).toHaveText('LifeOS 已保存清单');
 const row=(id:string)=>page.locator('[data-id="'+id+'"]'),text='  原文用途\n先核对备份，再决定。  ';
 for(const id of ['N-0','N-1','N-2']){
  await row(id).getByLabel('备注与处理要求').fill(text+id);await row(id).getByRole('button',{name:'保存备注',exact:true}).click();await expect(page.locator('#notice')).toHaveText('备注已保存，并已读回 LifeOS。');await expect(row(id).locator('.note-status')).toHaveText('已保存');
 }
 assert.deepEqual((await service.get(owner))!.decisions,[{id:'N-0',decision:'keep'}]);assert.deepEqual((await service.get(owner))!.checklist,checklist);
 await page.reload();await expect(row('N-2').getByLabel('备注与处理要求')).toHaveValue(text+'N-2');
 const readerContext=await browser.newContext(),reader=await readerContext.newPage();await reader.goto(origin+'/personal/storage-review');await expect(reader.locator('[data-id="N-1"] textarea')).toHaveValue(text+'N-1');await readerContext.close();
 for(const width of [1365,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 await row('N-0').getByLabel('备注与处理要求').fill('unsent exact draft');const beforeDraft=wire.length,draftBase=(await service.get(owner))!;
 await service.saveNote(owner,{expectedRevision:draftBase.revision,checklistRevision:checklist.revision,id:'N-0',note:'newer remote note while draft was unsent'},'synthetic-note-draft-concurrent');
 await page.reload();await expect(row('N-0').getByLabel('备注与处理要求')).toHaveValue('unsent exact draft');assert.equal(wire.length,beforeDraft);
 await row('N-0').getByRole('button',{name:'保存备注',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.locator('#pending-description')).toContainText('newer remote note while draft was unsent');await expect(page.locator('#pending-description')).toContainText('原请求已明确拒绝');
 assert.equal(JSON.parse(wire.at(-1)!.body).expectedRevision,draftBase.revision,'refresh must not silently rebase a previously retained draft');
 await page.locator('#retry-decision').click();await expect(page.locator('#notice')).toHaveText('备注已保存，并已读回 LifeOS。');
 conflict=true;await row('N-0').getByLabel('备注与处理要求').fill('owner CAS draft');await row('N-0').getByRole('button',{name:'保存备注',exact:true}).click();await expect(page.locator('#pending-input')).toBeVisible();await expect(row('N-0').getByLabel('备注与处理要求')).toHaveValue('owner CAS draft');await expect(page.locator('#pending-description')).toContainText('Concurrent synthetic note');
 const rejected=wire.at(-1)!;await page.locator('#retry-decision').click();await expect(page.locator('#pending-input')).toBeHidden();assert.notEqual(wire.at(-1)!.key,rejected.key);assert.equal((await service.get(owner))!.notes!.find(n=>n.id==='N-0')!.note,'owner CAS draft');
 lose=true;offline=true;await row('N-2').getByLabel('备注与处理要求').fill('unknown original draft');await row('N-2').getByRole('button',{name:'保存备注',exact:true}).click();await expect(page.locator('#pending-input')).toBeVisible();await expect(page.locator('#pending-description')).toContainText('原请求结果未知');await expect(page.locator('#notice')).toHaveText('尚未确认保存结果。请先打开 LifeOS 清单读回，再继续。');await expect(page.locator('#retry-decision')).toBeDisabled();const original=wire.at(-1)!,beforeReplay=wire.length;
 assert.equal((await service.get(owner))!.notes!.find(n=>n.id==='N-2')!.note,'unknown original draft','the synthetic write really committed before its receipt was lost');
 await page.reload();await expect(page.locator('#pending-input')).toBeVisible();assert.equal(wire.length,beforeReplay);offline=false;
 // A later write makes a matching latest snapshot insufficient; replay only
 // the original receipt, then show the later data without overwriting it.
 const latest=(await service.get(owner))!;await service.saveNote(owner,{expectedRevision:latest.revision,checklistRevision:checklist.revision,id:'N-2',note:'later note'},'synthetic-later-note');
 await page.locator('#open-server').click();await expect(page.locator('#retry-decision')).toBeEnabled();await page.locator('#retry-decision').click();
 try{await expect(page.locator('#pending-input')).toBeHidden();}catch(e){console.log('SYNTHETIC_RECOVERY_TRACE',JSON.stringify({wire,responseTrace,notice:await page.locator('#notice').textContent(),errors}));throw e;}
 assert.deepEqual(wire.at(-1),original);await expect(row('N-2').getByLabel('备注与处理要求')).toHaveValue('later note');
 await row('N-1').getByRole('button',{name:'清空并保存',exact:true}).click();await expect(page.locator('#notice')).toHaveText('备注已保存，并已读回 LifeOS。');await page.reload();await expect(row('N-1').getByLabel('备注与处理要求')).toHaveValue('');
 denied=true;await page.locator('#open-server').click();await expect(page.locator('.row')).toHaveCount(0);assert.equal(await page.locator('body').textContent().then(text=>text?.includes('later note')),false);
 denied=false;await page.locator('#open-server').click();await expect(row('N-2').getByLabel('备注与处理要求')).toHaveValue('later note');
 await page.evaluate(()=>{const set=Storage.prototype.setItem;Object.defineProperty(Storage.prototype,'setItem',{configurable:true,value:function(key:string,value:string){if(this===sessionStorage)throw Error('synthetic session full');return set.call(this,key,value);}});});
 const beforeDenied=wire.length;await row('N-1').getByLabel('备注与处理要求').fill('unretained draft');await row('N-1').getByRole('button',{name:'保存备注',exact:true}).click();await expect(page.locator('#notice')).toContainText('尚未发送');assert.equal(wire.length,beforeDenied);
 assert.deepEqual(errors,[]);assert.equal((await service.get(owner))!.decisions[0]!.decision,'keep');
 console.log('STORAGE_NOTES_BROWSER_PASS '+JSON.stringify({isolatedMemoryOnly:true,widths:[1365,390],noteWrites:wire.length,originalPendingReplayed:true}));
});
