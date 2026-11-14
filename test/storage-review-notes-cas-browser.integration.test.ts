import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium,expect} from '@playwright/test';
import {storageReviewResponse} from '../app/personal/storage-review/response.ts';
import {handleStorageReviewRequest} from '../src/storage-review/http.ts';
import {StorageReviewService} from '../src/storage-review/service.ts';
import {MemoryPort} from './helpers/platform.ts';
import {PlatformError} from '../src/platform/domain.ts';

for(const action of ['edit','clear'] as const)test(`OPT-IN retained draft ${action} cannot silently adopt a refreshed remote revision`,{
 skip:process.env.RUN_STORAGE_REVIEW_NOTES_BROWSER_TESTS!=='1'&&'Requires actual Chrome and isolated synthetic route',timeout:30_000,
},async t=>{
 const memory=new MemoryPort(),transaction=memory.transaction.bind(memory),owner='synthetic-draft-owner',spaceId='synthetic-draft-space';
 memory.transaction=(owner,key,run)=>transaction(owner,key,tx=>run({...tx,lockRecordIdentity:async()=>{}}));
 const service=new StorageReviewService(memory,{ownerId:owner,spaceId}),checklist={schema:1 as const,revision:'synthetic-draft-v1',context:{summary:''},items:[{id:'N1',title:'Synthetic protected item',body:'',question:'',group:'',kind:'file' as const,status:'protected' as const}]};
 await service.saveChecklist(owner,{expectedRevision:null,checklist},'synthetic-draft-create');
 await service.saveNote(owner,{expectedRevision:1,checklistRevision:checklist.revision,id:'N1',note:'original saved note'},'synthetic-draft-initial-note');
 const origin='http://127.0.0.1:32141',wire:{body:any;key:string|null}[]=[];
 const server=createServer(async(req,res)=>{
  try{
   const url=new URL(req.url!,origin);let response:Response;
   if(url.pathname==='/personal/storage-review')response=await storageReviewResponse(async()=>({id:owner}));
   else if(url.pathname==='/api/platform/personal/status')response=Response.json({scope:'personal-manual-candidate',storageVerified:true,storageReviewEnabled:true,ownerId:owner,spaceId});
   else{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks).toString();
    const headers=new Headers();for(const[k,v]of Object.entries(req.headers))if(v)headers.set(k,Array.isArray(v)?v.join(','):v);
    if(req.method==='PATCH')wire.push({body:JSON.parse(body),key:headers.get('idempotency-key')});
    response=(await handleStorageReviewRequest(new Request(url,{method:req.method,headers,...(body?{body}:{})}),{ownerId:owner,baseURL:origin,service,assertOwner:async()=>{},assertWritable:async()=>{}}))!;
   }
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){res.writeHead(e instanceof PlatformError?e.status:500,{'content-type':'application/json'});res.end(JSON.stringify({error:e instanceof PlatformError?e.code:'synthetic-error'}));}
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(32141,'127.0.0.1',resolve);});t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());const page=await browser.newPage();page.setDefaultTimeout(3000);
 await page.goto(origin+'/personal/storage-review');await expect(page.locator('#sync-state')).toHaveText('LifeOS 已保存清单');
 await page.getByLabel('备注与处理要求').fill('retained owner draft');
 const original=(await service.get(owner))!;
 await service.saveNote(owner,{expectedRevision:original.revision,checklistRevision:checklist.revision,id:'N1',note:'newer remote note'},'synthetic-draft-external-note');
 await page.reload();await expect(page.getByLabel('备注与处理要求')).toHaveValue('retained owner draft');assert.equal(wire.length,0);
 if(action==='edit'){await page.getByLabel('备注与处理要求').fill('retained owner draft edited again');await page.getByRole('button',{name:'保存备注',exact:true}).click();}
 else await page.getByRole('button',{name:'清空并保存',exact:true}).click();
 // Wait for the entire write/readback cycle, even for the buggy implementation
 // which reports success instead of opening a conflict. Never assert early wire.
 await expect.poll(async()=>{const text=await page.locator('#notice').textContent();return text!=='正在保存并读回 LifeOS…'&&wire.length===1;}).toBe(true);
 console.log('SYNTHETIC_DRAFT_CAS',JSON.stringify({action,originalRevision:original.revision,submittedRevision:wire[0]!.body.expectedRevision,currentRevision:(await service.get(owner))!.revision}));
 assert.equal(wire[0]!.body.expectedRevision,original.revision);
 await expect(page.locator('#pending-description')).toContainText('原请求已明确拒绝');await expect(page.locator('#pending-description')).toContainText('newer remote note');
 assert.equal((await service.get(owner))!.notes![0]!.note,'newer remote note');
 const first=wire[0]!;await page.locator('#retry-decision').click();await expect(page.locator('#pending-input')).toBeHidden();assert.equal(wire.length,2);assert.notEqual(wire[1]!.key,first.key);
 assert.equal(wire[1]!.body.expectedRevision,original.revision+1);assert.equal(wire[1]!.body.checklistRevision,checklist.revision);
 const expected=action==='clear'?'':'retained owner draft edited again';assert.equal((await service.get(owner))!.notes?.[0]?.note??'',expected);
 await page.reload();await expect(page.getByLabel('备注与处理要求')).toHaveValue(expected);
});
