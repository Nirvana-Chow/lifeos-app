import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium,type Browser,type BrowserContext} from '@playwright/test';
import {storageReviewResponse} from '../app/personal/storage-review/response.ts';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import type {PlatformRepository,Transaction} from '../src/platform/contracts.ts';
import {MemoryPort} from './helpers/platform.ts';
import {verifyPrivateStorageReview} from './helpers/private-business-browser-fixture.ts';

for(const fault of ['none','wrong-denial','extra-read','write','retained-rows'] as const)test('OPT-IN original private storage session oracle: '+fault,{
 skip:process.env.RUN_STORAGE_REVIEW_BROWSER_TESTS!=='1'&&'Requires native Chrome and isolated synthetic HTTP fixture',timeout:40000,
},async t=>{
 const memory=new MemoryPort(),owner='personal-review-user';
 const repository=new Proxy(memory as PlatformRepository,{get(target,key,receiver){
  if(key!=='transaction')return Reflect.get(target,key,receiver);
  return <T>(recordOwner:string,commandKey:string,run:(tx:Transaction)=>Promise<T>)=>memory.transaction(recordOwner,commandKey,tx=>run({...tx,lockRecordIdentity:async()=>{}}));
 }});
 const reads:{path:string;method:string;authenticated:boolean;status:number}[]=[],errors:string[]=[];
 const server=createServer(async(req,res)=>{
  const path=req.url??'/',authenticated=(req.headers.cookie??'').includes('synthetic-storage-session=present');
  let response:Response;
  try{
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
   const headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value);
   const request=new Request(origin+path,{method:req.method,headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})});
   if(path==='/personal/storage-review')response=await storageReviewResponse(async()=>authenticated?{id:owner}:null);
   else if(path==='/login')response=new Response('<!doctype html><h1>Synthetic login</h1>',{headers:{'content-type':'text/html','cache-control':'private, no-store'}});
   else if(!authenticated&&fault==='wrong-denial'&&path==='/api/platform/personal/status')response=Response.json({error:{code:'SYNTHETIC_WRONG_DENIAL'}},{status:403,headers:{'cache-control':'private, no-store'}});
   else response=await createPersonalPlatformHandler({repository,config:{ownerId:owner,ownerEmail:'fixture@example.invalid',spaceId:'personal-review-space',databaseName:'synthetic',baseURL:origin,allowedTypes:['todo','journal'],approval:'personal-manual-v1'},storageVerified:true,sessions:{read:async()=>authenticated?{userId:owner,email:'fixture@example.invalid'}:null},assertWritable:async()=>{}})(request);
  }catch{errors.push('unexpected-server-error');response=new Response(null,{status:500});}
  reads.push({path,method:req.method??'GET',authenticated,status:response.status});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 const address=server.address();assert.ok(address&&typeof address==='object');const origin='http://127.0.0.1:'+address.port;
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});t.after(()=>browser.close());
 const setup=async(context:BrowserContext)=>{
  context.setDefaultTimeout(5000);context.setDefaultNavigationTimeout(10000);
  if(fault!=='none')await context.addInitScript(mode=>{
   let denied=false;const original=window.fetch.bind(window),replace=Element.prototype.replaceChildren;
   Element.prototype.replaceChildren=function(...nodes){if(mode==='retained-rows'&&denied&&this.id==='list')return;return Reflect.apply(replace,this,nodes);};
   window.fetch=async(input,init)=>{
    const response=await original(input,init);
    const path=new URL(input instanceof Request?input.url:String(input),location.origin).pathname;
    if(path==='/api/platform/personal/status'&&response.status===401){
     denied=true;
     if(mode==='extra-read')await original('/api/platform/personal/storage-review');
     if(mode==='write')await original('/api/platform/personal/storage-review',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    }
    return response;
   };
  },fault);
  return context;
 };
 const fixtureBrowser=new Proxy(browser,{get(target,key){
  if(key==='newContext')return async(options?:Parameters<Browser['newContext']>[0])=>setup(await target.newContext(options));
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 const context=await fixtureBrowser.newContext({viewport:{width:1365,height:900}});t.after(()=>context.close());
 await context.addCookies([{name:'synthetic-storage-session',value:'present',url:origin,httpOnly:true,sameSite:'Strict'}]);
 const page=await context.newPage();page.on('pageerror',()=>errors.push('unexpected-browser-error'));
 const run=()=>verifyPrivateStorageReview({browser:fixtureBrowser,context,page},origin);
 if(fault==='none'){
  await run();
  assert.deepEqual(reads.filter(row=>!row.authenticated&&row.path!=='/favicon.ico').map(({path,method,status})=>({path,method,status})),[
   {path:'/api/platform/personal/status',method:'GET',status:401},
   {path:'/personal/storage-review',method:'GET',status:307},
   {path:'/login',method:'GET',status:200},
  ]);
  // Retain the original endpoint's separate, actual unauthenticated denial.
  const response=await fetch(origin+'/api/platform/personal/storage-review');
  assert.equal(response.status,401);assert.match(response.headers.get('cache-control')??'',/private.*no-store/);
  assert.equal((await response.text()).includes('isolated-browser-storage-review'),false);
 }else{
  await assert.rejects(run(),fault==='wrong-denial'?/403 !== 401/:fault==='retained-rows'?/toHaveCount/:/session denial must stop before storage reads or any writes/);
  t.diagnostic('original helper strictly rejected '+fault);
 }
 assert.deepEqual(errors,[]);
 t.after(()=>{assert.equal(browser.isConnected(),false);assert.equal(server.listening,false);t.diagnostic('cleanup: browser disconnected=true, HTTP listener stopped=true');});
});

test('private storage helper rejects alternative remote, noncanonical and privileged loopback origins before browser IO',async()=>{
 for(const origin of ['https://evil.example','http://localhost:12345','https://127.0.0.1:12345','http://127.0.0.1:80','http://127.0.0.1:12345/','http://127.0.0.1:12345?x=1','http://user:password@127.0.0.1:12345']){
  await assert.rejects(verifyPrivateStorageReview({} as Parameters<typeof verifyPrivateStorageReview>[0],origin),/isolated storage fixture origin/);
 }
});
