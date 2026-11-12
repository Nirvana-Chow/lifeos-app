import assert from 'node:assert/strict';
import test,{type TestContext} from 'node:test';
import {mkdtempSync,rmSync,readdirSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {canonicalJSON} from '../src/mcp-server-host-candidate/contracts.ts';
import {DurableStore} from '../src/mcp-candidate/native-store.mjs';
import {createMcpChannel,type BrokerPort} from '../src/mcp-server-host-candidate/channel.ts';
import {localDefinitions} from '../src/mcp-server-host-candidate/contracts.ts';
import {DurableMcpClient} from '../src/mcp-server-host-candidate/client.ts';
const fingerprint='a'.repeat(64),id='11111111-1111-4111-8111-111111111111',sourceId='22222222-2222-4222-8222-222222222222';
const fields={title:'Synthetic journal',text:'Body',occurredOn:null,personal:null};
const command={fields,idempotencyKey:'synthetic-durable-command-01'};
function fixture(t:TestContext){
 const directory=mkdtempSync(join(tmpdir(),'lifeos-mcp-durable-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 let definitions=structuredClone(localDefinitions),currentFingerprint=fingerprint;
 let alter:(value:any)=>any=value=>value;
 let current={id,sourceId,revision:1,fields},commits=0,uses=0,readFailure=false,lose=false,badReceipt=false,rejection=0;
 const receipts=new Map<string,typeof current>();const sent:string[]=[];const events:string[]=[];
 const port:BrokerPort={beforeUse:async()=>{uses++;},fingerprint:async()=>currentFingerprint,request:async envelope=>{
  const rpc=JSON.parse(envelope.encoded);let structuredContent:unknown;
  if(rpc.method==='server/discover')return{status:200,credentialFingerprint:currentFingerprint,data:{jsonrpc:'2.0',id:rpc.id,result:{resultType:'complete',supportedVersions:['2026-07-28'],capabilities:{tools:{}}}}};
  if(rpc.params.name==='lifeos_discover'){events.push('catalog');structuredContent={apiVersion:'2',operations:definitions};}
  else{const {operationId,arguments:args}=rpc.params.arguments;
   if(operationId.startsWith('get')){events.push('get');structuredContent=readFailure?{ok:false,status:503,error:'GET_UNAVAILABLE'}:{ok:true,status:200,data:{entry:current}};}
   else{events.push('write');sent.push(envelope.encoded);
    // The actual store must already contain the exact wire envelope before the port sees it.
    const saved=rows();assert.ok(saved.some(row=>row.request.encoded===envelope.encoded));
    if(rejection)structuredContent={ok:false,status:rejection,error:'ACCESS_DENIED'};
    else{let receipt=receipts.get(args.idempotencyKey);if(!receipt){commits++;receipt={id,sourceId,revision:operationId.startsWith('update')?args.expectedRevision+1:1,fields:args.fields};receipts.set(args.idempotencyKey,receipt);current=receipt;}
     if(lose){lose=false;throw Error('response lost after commit');}
     structuredContent={ok:true,status:201,data:{entry:badReceipt?{...receipt,revision:99}:receipt}};
    }
   }
  }
  return{status:200,credentialFingerprint:currentFingerprint,data:{jsonrpc:'2.0',id:rpc.id,result:{resultType:'complete',content:[],structuredContent:alter(structuredContent)}}};
 }};
 function rows():any[]{return readdirSync(directory).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(readFileSync(join(directory,n),'utf8')));}
 function client(store=new DurableStore(directory,fingerprint)){return new DurableMcpClient({channel:createMcpChannel(port),store,localDefinitions});}
 return{directory,rows,client,sent,events,alter:(fn:typeof alter)=>{alter=fn;},get uses(){return uses;},get commits(){return commits;},lose:()=>{lose=true;},bad:()=>{badReceipt=true;},revoke:()=>{definitions=[];},drift:()=>{definitions=structuredClone(localDefinitions);(definitions[0] as any).description+=' drift';},bind:()=>{currentFingerprint='b'.repeat(64);},reject:(status:number)=>{rejection=status;},failGet:()=>{readFailure=true;},later:()=>{current={...current,revision:current.revision+1};},setCurrent:(value:typeof current)=>{current=value;}};
}
test('invalid local arguments touch neither broker nor writer lock',async t=>{
 const f=fixture(t),store=new DurableStore(f.directory,fingerprint);let locks=0;store.exclusive=async()=>{locks++;throw Error('must not lock');};
 const c=f.client(store);assert.equal((await c.execute('createJournal',{})).ok,false);assert.equal(locks,0);assert.equal(f.uses,0);assert.deepEqual(f.rows(),[]);
});
test('fresh reduced catalog and definition drift stop before prepare',async t=>{const f=fixture(t),c=f.client();f.revoke();assert.equal((await c.execute('createJournal',command)).error,'OPERATION_UNAVAILABLE');f.drift();assert.equal((await c.execute('createJournal',command)).error,'HOST_CONTRACT_MISMATCH');assert.equal(f.sent.length,0);assert.deepEqual(f.rows(),[]);});
test('successful write persists exact command then receipt then independent GET; restart never rewrites settled',async t=>{
 const f=fixture(t),r=await f.client().execute('createJournal',command);assert.equal(r.verification?.verified,true);assert.equal(f.commits,1);assert.equal(f.rows()[0].state,'complete');assert.equal(f.rows()[0].request.transport,'server-mcp-v1');assert.equal(f.rows()[0].request.key,command.idempotencyKey);
 assert.ok(f.events.indexOf('get')>f.events.indexOf('write'));assert.equal((await f.client().execute('createJournal',command)).verification?.verified,true);assert.equal(f.sent.length,1);
});
test('committed response loss resumes original bytes/id/key after new store and channel; no automatic retry',async t=>{
 const f=fixture(t);f.lose();const first=await f.client().execute('createJournal',command);assert.equal(first.outcome,'unknown');assert.equal(f.sent.length,1);assert.equal(f.rows()[0].state,'unknown');
 const second=await f.client().execute('createJournal',command);assert.equal(second.verification?.verified,true);assert.equal(f.commits,1);assert.equal(f.sent.length,2);assert.equal(f.sent[0],f.sent[1]);assert.equal(f.rows()[0].request.requestId,first.recovery?.requestId);
});
for(const checkpoint of ['prepare','receipt','finish'] as const)test('crash at '+checkpoint+' preserves recoverable state without duplicate commits',async t=>{
 const f=fixture(t),store=new DurableStore(f.directory,fingerprint),original=store[checkpoint].bind(store);
 (store as any)[checkpoint]=(...args:any[])=>{(original as (...a:any[])=>void)(...args);throw Error('synthetic crash after fsync');};
 await f.client(store).execute('createJournal',command).catch(()=>{});
 const result=await f.client().execute('createJournal',command);assert.equal(result.verification?.verified,true);assert.equal(f.commits,1);assert.equal(f.sent.length,1);
});
test('unknown body mutation and legacy command cannot be adopted',async t=>{
 const f=fixture(t);f.lose();await f.client().execute('createJournal',command);assert.equal((await f.client().execute('createJournal',{...command,fields:{...fields,text:'Changed'}})).error,'ORIGINAL_COMMAND_REQUIRED');assert.equal(f.sent.length,1);
 const other='synthetic-legacy-02',store=new DurableStore(f.directory,fingerprint);await store.exclusive(async()=>store.prepare({requestId:sourceId,key:other,operationId:'createJournal',encoded:'{}'}));
 assert.equal((await f.client().execute('createJournal',{...command,idempotencyKey:other})).error,'LEGACY_HOST_RECOVERY_REQUIRED');assert.equal(f.sent.length,1);
});
test('a different key is a distinct command, never claimed to recover another intent',async t=>{const f=fixture(t);f.lose();await f.client().execute('createJournal',command);const r=await f.client().execute('createJournal',{...command,idempotencyKey:'synthetic-new-key-02'});assert.equal(r.ok,true);assert.equal(f.commits,2);assert.equal(f.rows().length,2);});
test('settled GET unavailable and later revision retain receipt without verified claim',async t=>{
 const f=fixture(t);await f.client().execute('createJournal',command);f.later();const later=await f.client().execute('createJournal',command);assert.equal(later.ok,true);assert.equal(later.verification?.state,'LATER_REVISION');f.failGet();const unavailable=await f.client().execute('createJournal',command);assert.equal(unavailable.ok,true);assert.equal(unavailable.verification?.state,'READBACK_UNAVAILABLE');assert.equal(f.sent.length,1);
});
test('invalid receipt is unknown even when GET could match',async t=>{const f=fixture(t);f.bad();const r=await f.client().execute('createJournal',command);assert.equal(r.outcome,'unknown');assert.equal(f.rows()[0].state,'unknown');assert.equal(f.events.includes('get'),false);});
test('revoked catalog and changed fingerprint block unknown replay',async t=>{const f=fixture(t);f.lose();await f.client().execute('createJournal',command);f.revoke();assert.equal((await f.client().execute('createJournal',command)).ok,false);f.bind();assert.equal((await f.client().execute('createJournal',command)).ok,false);assert.equal(f.sent.length,1);});
test('unknown followed by explicit rejection remains unknown across restart',async t=>{const f=fixture(t);f.lose();await f.client().execute('createJournal',command);f.reject(403);const r=await f.client().execute('createJournal',command);assert.equal(r.outcome,'unknown');assert.equal(f.rows()[0].state,'unknown');});
test('first explicit rejection is retained, without claiming a committed receipt',async t=>{const f=fixture(t);f.reject(409);const r=await f.client().execute('createJournal',command);assert.equal(r.ok,false);assert.equal(r.status,409);assert.equal(r.outcome,undefined);assert.equal(f.rows()[0].rejection.status,409);});
test('CAS mismatch blocks prepare; unknown update replays saved preimage after revision advanced',async t=>{
 const f=fixture(t),update={...command,id,expectedRevision:2};assert.equal((await f.client().execute('updateJournal',update)).error,'CAS_PREIMAGE_CHANGED');assert.equal(f.rows().length,0);
 const valid={...update,expectedRevision:1};f.lose();assert.equal((await f.client().execute('updateJournal',valid)).outcome,'unknown');const gets=f.events.filter(x=>x==='get').length;
 assert.equal((await f.client().execute('updateJournal',valid)).verification?.verified,true);assert.equal(f.commits,1);assert.equal(f.events.filter(x=>x==='get').length,gets+1);
});
test('journal digest and credential binding corruption stop replay',async t=>{const f=fixture(t);f.lose();await f.client().execute('createJournal',command);const file=join(f.directory,readdirSync(f.directory).find(n=>n.endsWith('.json'))!),row=JSON.parse(readFileSync(file,'utf8'));row.request.encoded+=' ';writeFileSync(file,JSON.stringify(row),{mode:0o600});assert.equal((await f.client().execute('createJournal',command)).error,'JOURNAL_TAMPERED');assert.equal(f.sent.length,1);});
test('shared real writer lock refuses concurrent host and never steals abandoned lock',async t=>{
 const f=fixture(t),store=new DurableStore(f.directory,fingerprint);await store.exclusive(async()=>{assert.equal((await f.client().execute('createJournal',command)).error,'NATIVE_WRITER_BUSY_OR_CRASHED');});
 mkdirSync(join(f.directory,'.writer-lock'),{mode:0o700});writeFileSync(join(f.directory,'.writer-lock','owner.json'),JSON.stringify({pid:2147483647}),{mode:0o600});assert.equal((await f.client().execute('createJournal',command)).error,'NATIVE_WRITER_BUSY_OR_CRASHED');assert.equal(f.sent.length,0);assert.ok(readdirSync(f.directory).includes('.writer-lock'));
});

test('caller mutation while awaiting provider cannot change persisted business body',async t=>{
 const f=fixture(t),store=new DurableStore(f.directory,fingerprint),original=store.exclusive.bind(store);
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});store.exclusive=fn=>original(async()=>{await gate;return fn();});
 const personal={type:'journal',links:{project:{id,sourceId,revision:1},domain:null,topics:[],people:[]}};
 const input={...command,fields:{...fields,personal}};
 const pending=f.client(store).execute('createJournal',input);personal.links.project.revision=999;release();await pending;
 const request=f.rows()[0].request;
 assert.equal(JSON.parse(request.businessEncoded).fields.personal.links.project.revision,1);
 assert.equal((await f.client().execute('createJournal',{...command,fields:{...fields,personal:{...personal,links:{...personal.links,project:{id,sourceId,revision:1}}}}})).ok,true);
});
test('CAS preimage wrong identity or malformed source stops before prepare',async t=>{
 const f=fixture(t);f.setCurrent({id:sourceId,sourceId,revision:1,fields});
 assert.equal((await f.client().execute('updateJournal',{...command,id,expectedRevision:1})).error,'CAS_PREIMAGE_CHANGED');assert.equal(f.sent.length,0);assert.equal(f.rows().length,0);
 f.setCurrent({id,sourceId:'invalid-source',revision:1,fields});
 assert.equal((await f.client().execute('updateJournal',{...command,id,expectedRevision:1})).error,'CAS_PREIMAGE_CHANGED');assert.equal(f.sent.length,0);
});
test('malformed inner success/failure discriminants cannot settle a receipt',async t=>{
 const f=fixture(t);f.alter(value=>value.ok===true&&value.status===201?{...value,outcome:'unknown'}:value);
 const r=await f.client().execute('createJournal',command);assert.equal(r.outcome,'unknown');assert.equal(f.rows()[0].state,'unknown');assert.equal(f.events.includes('get'),false);
});
for(const field of ['definitionJSON','businessEncoded','transport','binding','receipt'] as const)test('persisted '+field+' mismatch cannot authorize a replay',async t=>{
 const f=fixture(t);if(field!=='receipt')f.lose();await f.client().execute('createJournal',command);
 const file=join(f.directory,readdirSync(f.directory).find(n=>n.endsWith('.json'))!),row=JSON.parse(readFileSync(file,'utf8'));
 if(field==='binding')row.binding.credentialFingerprint='b'.repeat(64);
 else if(field==='receipt')row.receipt.data.entry.fields.text='corrupt';
 else{row.request[field]='invalid';row.digest=createHash('sha256').update(canonicalJSON(row.request)).digest('hex');}
 writeFileSync(file,JSON.stringify(row),{mode:0o600});const r=await f.client().execute('createJournal',command);assert.equal(r.ok,false);assert.equal(f.sent.length,1);assert.notEqual(r.verification?.verified,true);
});
test('prepare failure before persistence sends no business request',async t=>{const f=fixture(t),store=new DurableStore(f.directory,fingerprint);store.prepare=()=>{throw Error('synthetic fsync failure');};assert.equal((await f.client(store).execute('createJournal',command)).ok,false);assert.equal(f.sent.length,0);assert.equal(f.rows().length,0);});
test('discover derives filtered index and detail without forwarding unknown remote authority',async t=>{const f=fixture(t),c=f.client();const index=await c.discover({view:'index'});assert.equal((index.operations as any[]).length,53);assert.equal((index.operations as any[])[0].inputSchema,undefined);const detail=await c.discover({operationId:'createJournal'});assert.equal((detail.operation as any).id,'createJournal');await assert.rejects(c.discover({operationId:'unknown'}));const r=await c.execute('getJournal',{id});assert.equal(r.ok,true);assert.equal(f.rows().length,0);assert.equal(f.sent.length,0);});

test('corrupt stored receipt discriminants are rejected before verification and no write is sent',async t=>{
 const f=fixture(t);await f.client().execute('createJournal',command);const file=join(f.directory,readdirSync(f.directory).find(n=>n.endsWith('.json'))!),row=JSON.parse(readFileSync(file,'utf8'));row.receipt.status=403;writeFileSync(file,JSON.stringify(row),{mode:0o600});const r=await f.client().execute('createJournal',command);assert.equal(r.ok,false);assert.notEqual(r.verification?.verified,true);assert.equal(f.sent.length,1);
});
test('initial transport 403 is preserved as rejection, not an unknown submission',async t=>{
 const f=fixture(t),store=new DurableStore(f.directory,fingerprint),channel=createMcpChannel({beforeUse:async()=>{},fingerprint:async()=>fingerprint,request:async envelope=>{
  const rpc=JSON.parse(envelope.encoded);
  if(rpc.params.name==='lifeos_call')return{status:403,credentialFingerprint:fingerprint,data:{}};
  return{status:200,credentialFingerprint:fingerprint,data:{jsonrpc:'2.0',id:rpc.id,result:rpc.method==='server/discover'?{resultType:'complete',supportedVersions:['2026-07-28'],capabilities:{tools:{}}}:{resultType:'complete',content:[],structuredContent:{apiVersion:'2',operations:localDefinitions}}}};
 }});
 const r=await new DurableMcpClient({channel,store,localDefinitions}).execute('createJournal',command);assert.equal(r.status,403);assert.equal(r.outcome,undefined);assert.equal(f.rows()[0].rejection.status,403);
});
test('settled recovery still rejects an invalid frozen protocol envelope',async t=>{
 const f=fixture(t);await f.client().execute('createJournal',command);const file=join(f.directory,readdirSync(f.directory).find(n=>n.endsWith('.json'))!),row=JSON.parse(readFileSync(file,'utf8'));
 const rpc=JSON.parse(row.request.encoded);rpc.params._meta['io.modelcontextprotocol/protocolVersion']='invalid';row.request.encoded=JSON.stringify(rpc);row.digest=createHash('sha256').update(canonicalJSON(row.request)).digest('hex');writeFileSync(file,JSON.stringify(row),{mode:0o600});
 assert.equal((await f.client().execute('createJournal',command)).error,'ORIGINAL_COMMAND_REQUIRED');assert.equal(f.sent.length,1);
});
test('canonical key ordering resumes the same frozen command',async t=>{const f=fixture(t);f.lose();await f.client().execute('createJournal',command);const r=await f.client().execute('createJournal',{idempotencyKey:command.idempotencyKey,fields:{personal:null,occurredOn:null,text:'Body',title:'Synthetic journal'}});assert.equal(r.verification?.verified,true);assert.equal(f.sent[0],f.sent[1]);assert.equal(f.commits,1);});
test('server readback evidence remains distinct from the hosts independent GET',async t=>{
 const f=fixture(t);f.alter(value=>value.status===201?{...value,readback:{ok:false,status:503,error:'SERVER_READBACK_UNAVAILABLE'},verification:{verified:false,state:'READBACK_UNAVAILABLE'}}:value);
 const r=await f.client().execute('createJournal',command);assert.equal(r.verification?.verified,true);assert.equal((r as any).serverReadback.error,'SERVER_READBACK_UNAVAILABLE');assert.equal((r as any).serverVerification.verified,false);assert.equal(f.rows()[0].receipt.readback.error,'SERVER_READBACK_UNAVAILABLE');
});

const requirementFields={title:'Synthetic requirement',body:'Purpose',phaseId:'now',priority:'P1',plannedStartOn:null,plannedEndOn:null};
const requirementBinding={baselineVersion:'synthetic-v1',itemVersion:1,digest:'a'.repeat(64)};
function requirementFixture(t:TestContext,privateRecord=false){
 const directory=mkdtempSync(join(tmpdir(),'lifeos-mcp-requirement-binding-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const recordId=privateRecord?id:'LO-REQ-001',binding=privateRecord?null:requirementBinding;
 let current:any={id:recordId,sourceId:privateRecord?sourceId:null,revision:privateRecord?1:0,fields:requirementFields,baselineBinding:binding,baselineConflict:false};
 let receipt:any,prepares=0,lose=false;const sent:string[]=[];
 const port:BrokerPort={beforeUse:async()=>{},fingerprint:async()=>fingerprint,request:async envelope=>{
  const rpc=JSON.parse(envelope.encoded);let result:any;
  if(rpc.method==='server/discover')result={resultType:'complete',supportedVersions:['2026-07-28'],capabilities:{tools:{}}};
  else if(rpc.params.name==='lifeos_discover')result={resultType:'complete',content:[],structuredContent:{apiVersion:'2',operations:localDefinitions}};
  else{
   const {operationId,arguments:args}=rpc.params.arguments;
   if(operationId==='updateRequirement'){
    sent.push(envelope.encoded);
    if(!receipt){receipt={id:recordId,sourceId,revision:args.expectedRevision+1,fields:args.fields,baselineBinding:args.baselineBinding,baselineConflict:false};current=receipt;}
    if(lose){lose=false;throw Error('synthetic committed response loss');}
   }
   result={resultType:'complete',content:[],structuredContent:{ok:true,status:200,data:{entry:operationId==='updateRequirement'?receipt:current}}};
  }
  return{status:200,credentialFingerprint:fingerprint,data:{jsonrpc:'2.0',id:rpc.id,result}};
 }};
 const command={id:recordId,expectedRevision:privateRecord?1:0,baselineBinding:binding,fields:requirementFields,idempotencyKey:'synthetic-requirement-binding-01'};
 const client=()=>{const store=new DurableStore(directory,fingerprint),prepare=store.prepare.bind(store);store.prepare=request=>{prepares++;prepare(request);};return new DurableMcpClient({channel:createMcpChannel(port),store,localDefinitions});};
 return{client,command,sent,get prepares(){return prepares;},get rows(){return readdirSync(directory).filter(name=>name.endsWith('.json'));},current:(value:any)=>{current={...current,...value};},lose:()=>{lose=true;}};
}
for(const changed of [
 {baselineVersion:'synthetic-new-v2',itemVersion:1,digest:'a'.repeat(64)},
 {baselineVersion:'synthetic-v1',itemVersion:2,digest:'a'.repeat(64)},
 {baselineVersion:'synthetic-v1',itemVersion:1,digest:'b'.repeat(64)},
])test('first requirement PATCH rejects changed complete binding before prepare: '+JSON.stringify(changed),async t=>{
 const f=requirementFixture(t);f.current({baselineBinding:changed,baselineConflict:false});const r=await f.client().execute('updateRequirement',f.command);
 assert.equal(r.error,'REQUIREMENT_BASELINE_CONFLICT');assert.equal(r.status,409);assert.equal(f.prepares,0);assert.equal(f.sent.length,0);assert.deepEqual(f.rows,[]);
});
test('requirement baseline conflict flag still blocks a matching binding',async t=>{
 const f=requirementFixture(t);f.current({baselineConflict:true});assert.equal((await f.client().execute('updateRequirement',f.command)).error,'REQUIREMENT_BASELINE_CONFLICT');assert.equal(f.prepares,0);assert.equal(f.sent.length,0);
});
test('matching requirement binding tolerates key ordering and private null remains supported',async t=>{
 for(const privateRecord of [false,true]){
  const f=requirementFixture(t,privateRecord);if(!privateRecord)f.current({baselineBinding:{digest:'a'.repeat(64),itemVersion:1,baselineVersion:'synthetic-v1'}});
  assert.equal((await f.client().execute('updateRequirement',f.command)).verification?.verified,true);assert.equal(f.prepares,1);assert.equal(f.sent.length,1);
 }
});
test('unknown requirement command replays saved binding without current preimage revalidation',async t=>{
 const f=requirementFixture(t);f.lose();assert.equal((await f.client().execute('updateRequirement',f.command)).outcome,'unknown');
 f.current({revision:2,baselineBinding:{...requirementBinding,itemVersion:2,digest:'b'.repeat(64)},baselineConflict:true});
 const r=await f.client().execute('updateRequirement',f.command);assert.equal(r.ok,true);assert.equal(r.verification?.state,'LATER_REVISION');assert.equal(f.prepares,1);assert.equal(f.sent.length,2);assert.equal(f.sent[0],f.sent[1]);
 const settled=await f.client().execute('updateRequirement',f.command);assert.equal(settled.ok,true);assert.equal(f.sent.length,2);
});
