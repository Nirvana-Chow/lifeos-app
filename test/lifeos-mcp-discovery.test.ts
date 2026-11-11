import assert from 'node:assert/strict';
import test from 'node:test';
import {Client,InMemoryTransport} from '@modelcontextprotocol/client';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/client/validators/ajv';
import {agentOperations} from '../src/agent-api/capabilities.ts';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {LifeOSApiClient} from '../src/mcp-candidate/client.ts';
import {createLifeOSMcpServer} from '../src/mcp-candidate/tools.ts';
import {parseArguments,argumentSchema} from '../src/mcp-candidate/schemas.ts';
import {z} from 'zod';
import {MemoryPort} from './helpers/platform.ts';

type Schema=Record<string,any>;
type Descriptor={id:string;inputSchema:Schema};
const origin='https://discovery.example.invalid';
const validator=new AjvJsonSchemaValidator();
function assertMatches(schema:Schema,value:unknown){const result=validator.getValidator(schema)(value);assert.equal(result.valid,true,result.errorMessage);}
// This deliberately knows no business fields: required/properties, alternatives,
// examples, enums and nullability must be sufficient for an independent client.
function fromSchema(schema:Schema):any{
 if(schema.const!==undefined)return schema.const;
 if(schema.enum)return schema.enum[0];
 const alternatives=schema.oneOf??schema.anyOf;
 if(alternatives)return fromSchema(alternatives.find((s:Schema)=>s.type==='null')??alternatives[0]);
 if(schema.examples?.length)return schema.examples[0];
 if(schema.type==='null')return null;
 if(schema.type==='object'){
  assert.ok(schema.properties,'discovery must enumerate fields');
  return Object.fromEntries((schema.required??[]).map((key:string)=>[key,fromSchema(schema.properties[key])]));
 }
 if(schema.type==='array')return Array.from({length:schema.minItems??0},()=>fromSchema(schema.items));
 if(schema.type==='integer'||schema.type==='number')return schema.minimum??1;
 if(schema.type==='boolean')return true;
 assert.equal(schema.type,'string','discovery must describe a usable value');
 return 'Synthetic';
}
async function fixture({readOnly=false,legacy=false,disabledTypes=[] as string[]}={}){
 let revoked=false,loseWrite=false;
 const repository=new MemoryPort();repository.readCurrentSnapshot=async()=>structuredClone([...repository.rows.values()]);
 const transaction=repository.transaction.bind(repository);repository.transaction=(owner,key,run)=>transaction(owner,key,tx=>run({...tx,lockRecordIdentity:async()=>{},lockAgentGrant:async()=>true}));
 const operations=agentOperations.filter(op=>op.module!=='catalog'&&(!readOnly||op.method==='GET'));
 const grant={grantId:'synthetic-grant',ownerId:'synthetic-owner',spaceId:'synthetic-space',scopes:legacy?['todo:read','todo:write'] as const:[...new Set(operations.flatMap(op=>op.requiredScopes))],...(!legacy?{businessDataPolicy:'all-personal-business-v1' as const,allowedOperationIds:operations.map(op=>op.id)}:{})};
 const handler=createAgentHandler({enabled:true,mountPath:'/api/platform/agent',fenceWrites:true,modules:{organization:true,classification:false,personalRecords:true,businessDataPolicy:true,requirements:true},repository,config:{ownerId:grant.ownerId,spaceId:grant.spaceId,ownerEmail:'fixture@example.invalid',databaseName:'fixture',approval:'personal-manual-v1',allowedTypes:['todo','journal','project','domain','topic'],requirementsEnabled:true,requirementSupportEnabled:true,calendarEnabled:true,healthEnabled:true,peopleEnabled:true,financeEnabled:true,...(!disabledTypes.includes('media')?{mediaEnabled:true}:{}),...(!disabledTypes.includes('career')?{careerEnabled:true}:{}),...(!disabledTypes.includes('portfolio')?{portfolioEnabled:true}:{}),baseURL:origin},verify:async()=>revoked?null:grant,readCurrentGrant:async()=>revoked?null:grant,operationAvailable:()=>true,assertWritable:async()=>{}});
 const requests:string[]=[];
 const writes:{path:string;body:string;key:string|null}[]=[];
 const api=new LifeOSApiClient({origin,credentialProvider:async()=>'synthetic-injected-key'},async(input,init)=>{const request=new Request(input,init);requests.push(request.method+' '+new URL(request.url).pathname);request.headers.set('host',new URL(request.url).host);if(request.method!=='GET')writes.push({path:new URL(request.url).pathname,body:await request.clone().text(),key:request.headers.get('idempotency-key')});const response=await handler(request);if(loseWrite&&request.method!=='GET'){loseWrite=false;throw Error('Synthetic lost response after commit');}return response;});
 const server=createLifeOSMcpServer({client:api}),client=new Client({name:'synthetic-schema-consumer',version:'1'});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
 const discover=await client.callTool({name:'lifeos_discover',arguments:{}});assert.equal(discover.isError,false);
 const descriptors=(discover.structuredContent as {operations:Descriptor[]}).operations;
 return{client,descriptors,requests,writes,handler,loseNextWrite:()=>{loseWrite=true;},revoke:()=>{revoked=true;},close:async()=>{await client.close();await server.close();}};
}
// Removing concrete properties/required or the operation/arguments association
// prevents constructing any of these writes from advertised schemas alone.
test('discovery schemas construct native full POST/PATCH bodies and independent GET readback',async()=>{
 const f=await fixture();try{
  const tools=await f.client.listTools(),callSchema=tools.tools.find(t=>t.name==='lifeos_call')!.inputSchema as Schema;
  assert.ok(callSchema.oneOf,'tools/list must pair each operation ID with its arguments');
  for(const suffix of ['Finance','Journal','Calendar','Health','Person','Organization','Requirement','Todo','Media','Career','Portfolio']){
   const create=f.descriptors.find(op=>op.id==='create'+suffix)!;
   const args=fromSchema(create.inputSchema);args.idempotencyKey='synthetic-create-'+suffix;
   assertMatches(create.inputSchema,args);assertMatches(callSchema,{operationId:create.id,arguments:args});
   const saved=await f.client.callTool({name:'lifeos_call',arguments:{operationId:create.id,arguments:args}});
   const value=saved.structuredContent as any;assert.equal(value.ok,true,suffix+JSON.stringify(value));assert.equal(value.readback.ok,true,suffix);
   const entry=value.data.entry;
   const update=f.descriptors.find(op=>op.id==='update'+suffix)!;
   const next={...fromSchema(update.inputSchema),id:entry.id,...(args.type?{type:args.type}:{}),fields:entry.fields??args.fields,expectedRevision:entry.revision,idempotencyKey:'synthetic-update-'+suffix};
   if(suffix==='Requirement')next.baselineBinding=null;
   if(suffix==='Todo')next.fields={...next.fields,personal:null};
   const titleKey=suffix==='Finance'?'notes':'title';next.fields={...next.fields,[titleKey]:'Revised synthetic'};
   assertMatches(update.inputSchema,next);assertMatches(callSchema,{operationId:update.id,arguments:next});
   const edited=await f.client.callTool({name:'lifeos_call',arguments:{operationId:update.id,arguments:next}});
   const result=edited.structuredContent as any;assert.equal(result.ok,true,suffix+JSON.stringify(result));assert.equal(result.readback.ok,true,suffix);assert.ok(f.requests.some(request=>request==='GET /api/platform/agent'+('/v1/'+(suffix==='Organization'?'organization/'+args.type:suffix==='Requirement'?'requirements':suffix==='Todo'?'todos':'records/'+suffix.toLowerCase()))+'/'+entry.id));
   assert.equal((result.readback.data.entry??result.readback.data).revision,2,suffix);
  }
 }finally{await f.close();}
});

test('finance discovery publishes all nine fields, units and conditional kind contracts',async()=>{
 const f=await fixture();try{
  const fields=f.descriptors.find(op=>op.id==='createFinance')!.inputSchema.properties.fields;
  assert.equal(fields.oneOf.length,5);
  let originalEntryId:string|undefined;
  for(const variant of fields.oneOf){
   assert.deepEqual([...variant.required].sort(),['kind','amountMinor','currency','occurredOn','category','fromAccountRef','toAccountRef','originalEntryId','notes'].sort());
   assert.equal(variant.additionalProperties,false);
   assert.equal(variant.properties.amountMinor.type,'integer');assert.equal(variant.properties.amountMinor.minimum,1);assert.match(variant.properties.amountMinor.description,/分|minor/);
   const kind=variant.properties.kind.const,args={fields:fromSchema(variant),idempotencyKey:'synthetic-kind-'+kind};
   if(kind==='transfer'||kind==='repayment'){args.fields.fromAccountRef='synthetic-from';args.fields.toAccountRef='synthetic-to';}
   if(kind==='refund')args.fields.originalEntryId=originalEntryId;
   assertMatches(f.descriptors.find(op=>op.id==='createFinance')!.inputSchema,args);
   const result=await f.client.callTool({name:'lifeos_call',arguments:{operationId:'createFinance',arguments:args}});assert.equal(result.isError,false,JSON.stringify(result));
   if(kind==='expense')originalEntryId=(result.structuredContent as any).data.entry.id;
  }
  const refund=fields.oneOf.find((s:Schema)=>s.properties.kind.const==='refund');assert.equal(refund.properties.originalEntryId.type,'string');assert.match(refund.properties.originalEntryId.pattern,/0-9a-f/);
 }finally{await f.close();}
});

test('each advertised calendar and health metadata alternative reaches its native writer',async()=>{
 const f=await fixture();try{
  for(const suffix of ['Calendar','Health']){
   const descriptor=f.descriptors.find(op=>op.id==='create'+suffix)!;
   const metadata=descriptor.inputSchema.properties.fields.properties.personal;
   for(const branch of metadata.oneOf){
    const args=fromSchema(descriptor.inputSchema),personal=fromSchema(branch),kind=personal.calendarKind??personal.healthKind;
    args.fields.personal=personal;args.idempotencyKey='synthetic-branch-'+kind;
    assertMatches(descriptor.inputSchema,args);
    const saved=await f.client.callTool({name:'lifeos_call',arguments:{operationId:descriptor.id,arguments:args}});assert.equal(saved.isError,false,kind+JSON.stringify(saved));assert.equal((saved.structuredContent as any).readback.ok,true);
   }
  }
  const descriptor=f.descriptors.find(op=>op.id==='createCalendar')!,event=descriptor.inputSchema.properties.fields.properties.personal.oneOf[0];
  for(const branch of event.properties.schedule.anyOf[0].oneOf){
   const args=fromSchema(descriptor.inputSchema),personal=fromSchema(event),schedule=fromSchema(branch);
   if(schedule.kind==='all-day')schedule.endDate='2026-11-07';else schedule.endAt='2026-11-06T01:00:00Z';
   args.fields.personal={...personal,schedule};args.idempotencyKey='synthetic-schedule-'+schedule.kind;assertMatches(descriptor.inputSchema,args);
   const saved=await f.client.callTool({name:'lifeos_call',arguments:{operationId:descriptor.id,arguments:args}});assert.equal(saved.isError,false,JSON.stringify(saved));
  }
 }finally{await f.close();}
});

test('discovered route variants and current source pins construct organization and linked journal writes',async()=>{
 const f=await fixture();try{
  const descriptor=f.descriptors.find(op=>op.id==='createOrganization')!;let project:any;
  for(const branch of descriptor.inputSchema.oneOf){
   const args=fromSchema(branch);args.idempotencyKey='synthetic-org-'+args.type;assertMatches(descriptor.inputSchema,args);
   const saved=await f.client.callTool({name:'lifeos_call',arguments:{operationId:descriptor.id,arguments:args}});assert.equal(saved.isError,false,JSON.stringify(saved));
   if(args.type==='project'){const data=(saved.structuredContent as any).readback.data;project=data.entry??data;}
  }
  const journal=f.descriptors.find(op=>op.id==='createJournal')!,args=fromSchema(journal.inputSchema);
  const meta=journal.inputSchema.properties.fields.properties.personal.anyOf.find((s:Schema)=>s.type==='object');
  args.fields.personal={...fromSchema(meta),links:{project:{id:project.id,sourceId:project.sourceId,revision:project.revision}}};args.idempotencyKey='synthetic-journal-pin';assertMatches(journal.inputSchema,args);
  const saved=await f.client.callTool({name:'lifeos_call',arguments:{operationId:journal.id,arguments:args}});assert.equal(saved.isError,false,JSON.stringify(saved));assert.equal((saved.structuredContent as any).readback.data.entry.fields.personal.links.project.sourceId,project.sourceId);
  const feedback=f.descriptors.find(op=>op.id==='createFeedback')!,input=fromSchema(feedback.inputSchema);input.idempotencyKey='synthetic-feedback';
  const response=await f.client.callTool({name:'lifeos_call',arguments:{operationId:feedback.id,arguments:input}});assert.equal(response.isError,false);assert.equal((response.structuredContent as any).readback.ok,true);
 }finally{await f.close();}
});

test('record discovery exposes discriminated metadata, nullable dates, pins and full replace semantics',async()=>{
 const f=await fixture();try{
  const byId=(id:string)=>f.descriptors.find(op=>op.id===id)!.inputSchema;
  const health=byId('createHealth').properties.fields.properties.personal;
  assert.deepEqual(health.oneOf.map((s:Schema)=>s.properties.healthKind.const),['body','sleep','training']);
  const body=health.oneOf[0];assert.deepEqual(body.properties.weight.anyOf[0].properties.unit.enum,['kg','lb']);assert.equal(body.properties.circumference.required.length,6);
  const calendar=byId('createCalendar').properties.fields.properties.personal;
  assert.deepEqual(calendar.oneOf.map((s:Schema)=>s.properties.calendarKind.const),['event','anniversary','countdown','life-stage']);
  assert.ok(calendar.oneOf[0].properties.schedule.anyOf[0].oneOf);
  const pin=byId('createPerson').properties.fields.properties.personal.properties.links.properties.project.anyOf[0];
  assert.deepEqual(pin.required,['id','sourceId','revision']);assert.equal(pin.properties.revision.minimum,1);assert.equal(pin.additionalProperties,false);
  assert.match(byId('updateJournal').description,/complete|完整/);assert.match(byId('updateJournal').properties.expectedRevision.description,/CAS/);assert.match(byId('updateJournal').properties.idempotencyKey.description,/same|原/);
  assert.equal(f.descriptors.filter(op=>/Media|Career|Portfolio/.test(op.id)).length,12);
 }finally{await f.close();}
});

test('new record alternatives construct complete writes from their advertised schema',async()=>{
 const f=await fixture();try{
  for(const [suffix,discriminator,want] of [['Media','mediaKind',['book','film','series']],['Career','careerKind',['education','employment','achievement','resume','opportunity']],['Portfolio','portfolioKind',['account','asset','investment']]] as const){
   const descriptor=f.descriptors.find(op=>op.id==='create'+suffix)!;assert.ok(descriptor,'new type must be advertised');
   const branches=descriptor.inputSchema.properties.fields.properties.personal.oneOf;
   assert.deepEqual(branches.map((s:Schema)=>s.properties[discriminator].const),want);
   for(const branch of branches){const args=fromSchema(descriptor.inputSchema);args.fields.personal=fromSchema(branch);args.idempotencyKey='synthetic-new-'+args.fields.personal[discriminator];assertMatches(descriptor.inputSchema,args);const result=await f.client.callTool({name:'lifeos_call',arguments:{operationId:descriptor.id,arguments:args}});assert.equal(result.isError,false,JSON.stringify(result));assert.equal((result.structuredContent as any).readback.ok,true);}
  }
 }finally{await f.close();}
});

test('new modules stay absent for old grants, readonly writes and disabled native types',async()=>{
 for(const options of [{legacy:true},{readOnly:true},{disabledTypes:['media','career','portfolio']}]){
  const f=await fixture(options);try{
   const descriptors=f.descriptors.filter(op=>/Media|Career|Portfolio/.test(op.id));assert.equal(descriptors.length,options.readOnly?6:0);
   const list=await f.client.listTools();const advertised=JSON.stringify(list.tools.find(t=>t.name==='lifeos_call')?.inputSchema);
   for(const suffix of ['Media','Career','Portfolio']){assert.equal(advertised.includes('create'+suffix),false);assert.equal(advertised.includes('update'+suffix),false);const args=fromSchema(z.toJSONSchema(argumentSchema(agentOperations.find(op=>op.id==='create'+suffix)!)));args.idempotencyKey='synthetic-closed';const denied=await f.client.callTool({name:'lifeos_call',arguments:{operationId:'create'+suffix,arguments:args}});assert.equal((denied.structuredContent as any).error,'OPERATION_UNAVAILABLE');}
   assert.equal(f.writes.length,0);
  }finally{await f.close();}
 }
});

test('new module PATCH uses current CAS and frozen unknown-result retry without a second revision',async()=>{
 for(const suffix of ['Media','Career','Portfolio']){
  const f=await fixture();try{
   const create=f.descriptors.find(op=>op.id==='create'+suffix)!;assert.ok(create);
   const args=fromSchema(create.inputSchema);args.idempotencyKey='synthetic-retry-create-'+suffix;
   const created=await f.client.callTool({name:'lifeos_call',arguments:{operationId:create.id,arguments:args}}),entry=(created.structuredContent as any).data.entry;
   const update=f.descriptors.find(op=>op.id==='update'+suffix)!;const patch={id:entry.id,fields:{...entry.fields,text:'Original synthetic command'},expectedRevision:entry.revision,idempotencyKey:'synthetic-retry-update-'+suffix};assertMatches(update.inputSchema,patch);
   f.loseNextWrite();const result=await f.client.callTool({name:'lifeos_call',arguments:{operationId:update.id,arguments:patch}}),unknown=result.structuredContent as any;assert.equal(unknown.outcome,'unknown');assert.equal(unknown.readback.data.entry.revision,2);
   patch.fields.text='Caller changed object';const replay=await f.client.callTool({name:'lifeos_retry',arguments:{requestId:unknown.recovery.requestId}});const confirmed=replay.structuredContent as any;assert.equal(confirmed.ok,true);assert.equal(confirmed.data.duplicate,true);assert.equal(confirmed.readback.data.entry.revision,2);assert.equal(confirmed.readback.data.entry.fields.text,'Original synthetic command');assert.deepEqual(f.writes[2],f.writes[1]);
   const stale=await f.client.callTool({name:'lifeos_call',arguments:{operationId:update.id,arguments:{...patch,idempotencyKey:'synthetic-stale-'+suffix}}});assert.equal((stale.structuredContent as any).status,409);
   patch.expectedRevision=2;patch.idempotencyKey='synthetic-revoke-'+suffix;f.loseNextWrite();const pending=await f.client.callTool({name:'lifeos_call',arguments:{operationId:update.id,arguments:patch}});const before=f.writes.length;f.revoke();const denied=await f.client.callTool({name:'lifeos_retry',arguments:{requestId:(pending.structuredContent as any).recovery.requestId}});assert.equal((denied.structuredContent as any).status,401);assert.equal(f.writes.length,before);
  }finally{await f.close();}
 }
});

test('new module source pins use current owner records and reject stale or wrong-subtype references',async()=>{
 const f=await fixture();try{
  const schema=(id:string)=>f.descriptors.find(op=>op.id===id)!.inputSchema;
  let command=0;
  const send=async(id:string,args:any)=>{args.idempotencyKey='synthetic-pin-command-'+String(++command);assertMatches(schema(id),args);return(await f.client.callTool({name:'lifeos_call',arguments:{operationId:id,arguments:args}})).structuredContent as any;};
  const save=async(id:string,args:any)=>{const result=await send(id,args);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.readback.ok,true);return result.readback.data.entry??result.readback.data;};
  const pin=(entry:any)=>({id:entry.id,sourceId:entry.sourceId,revision:entry.revision});
  const project=await save('createOrganization',fromSchema(schema('createOrganization'))),records:Record<string,any>={};
  for(const suffix of ['Media','Career','Portfolio']){
   const args=fromSchema(schema('create'+suffix));args.fields.personal.links.project=pin(project);records[suffix]=await save('create'+suffix,args);
   const stale={...args,fields:{...args.fields,personal:{...args.fields.personal,links:{...args.fields.personal.links,project:{...pin(project),revision:2}}}}};
   const denied=await send('create'+suffix,stale);assert.equal(denied.status,409);assert.equal(denied.error,'REFERENCE_CONFLICT');
  }
  const career=schema('createCareer'),resume=fromSchema(career);resume.fields.personal=fromSchema(career.properties.fields.properties.personal.oneOf.find((s:Schema)=>s.properties.careerKind.const==='resume'));resume.fields.personal.facts=[pin(records.Career)];const savedResume=await save('createCareer',resume);
  const wrongResume={...resume,fields:{...resume.fields,personal:{...resume.fields.personal,facts:[pin(savedResume)]}}};assert.equal((await send('createCareer',wrongResume)).error,'REFERENCE_CONFLICT');
  const portfolio=schema('createPortfolio'),asset=fromSchema(portfolio);asset.fields.personal=fromSchema(portfolio.properties.fields.properties.personal.oneOf.find((s:Schema)=>s.properties.portfolioKind.const==='asset'));asset.fields.personal.account=pin(records.Portfolio);const savedAsset=await save('createPortfolio',asset);
  const investment=fromSchema(portfolio);investment.fields.personal=fromSchema(portfolio.properties.fields.properties.personal.oneOf.find((s:Schema)=>s.properties.portfolioKind.const==='investment'));investment.fields.personal.account=pin(records.Portfolio);investment.fields.personal.asset=pin(savedAsset);investment.fields.personal.currency='KWD';investment.fields.personal.costMinor='123456789012345678901234567890';investment.fields.personal.quantity='0.00000000000000000001';investment.fields.personal.asOf='2026-11-06';const savedInvestment=await save('createPortfolio',investment);assert.equal(savedInvestment.fields.personal.costMinor,'123456789012345678901234567890');assert.equal(savedInvestment.fields.personal.quantity,'0.00000000000000000001');
  const wrongInvestment={...investment,fields:{...investment.fields,personal:{...investment.fields.personal,account:pin(savedAsset),asset:null}}};assert.equal((await send('createPortfolio',wrongInvestment)).error,'REFERENCE_CONFLICT');
  const edit=await save('updateOrganization',{type:'project',id:project.id,fields:project.fields,expectedRevision:project.revision});assert.equal(edit.revision,2);
  for(const suffix of ['Media','Career','Portfolio']){const args=fromSchema(schema('create'+suffix));args.fields.personal.links.project=pin(project);assert.equal((await send('create'+suffix,args)).error,'REFERENCE_CONFLICT');}
 }finally{await f.close();}
});

test('full current catalog pairs all 55 reviewed operations and rejects altered new-operation scopes',async()=>{
 const api=new LifeOSApiClient({origin,credentialProvider:async()=>'synthetic-catalog-key'},async()=>Response.json({apiVersion:'2',operations:agentOperations}));
 const server=createLifeOSMcpServer({client:api}),client=new Client({name:'synthetic-full-catalog',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
 try{
  const discovery=await client.callTool({name:'lifeos_discover',arguments:{}}),descriptors=(discovery.structuredContent as {operations:Descriptor[]}).operations;
  const want=agentOperations.filter(op=>!['discover','discoverV2'].includes(op.id));assert.equal(descriptors.length,55);assert.deepEqual(descriptors.map(op=>op.id).sort(),want.map(op=>op.id).sort());
  const call=(await client.listTools()).tools.find(tool=>tool.name==='lifeos_call')!.inputSchema as Schema;assert.equal(call.oneOf.length,55);
  for(const descriptor of descriptors){const branch=call.oneOf.find((s:Schema)=>s.properties.operationId.const===descriptor.id);assert.deepEqual(branch.properties.arguments,descriptor.inputSchema);}
  assertMatches(call,{operationId:'createMedia',arguments:fromSchema(descriptors.find(op=>op.id==='createMedia')!.inputSchema)});
 }finally{await client.close();await server.close();}
 for(const suffix of ['Media','Career','Portfolio']){
  const operation=agentOperations.find(op=>op.id==='create'+suffix)!;
  for(const altered of [{...operation,requiredScopes:['todo:read','todo:write']},{...operation,path:'/v1/records/unreviewed'},{...operation,requiredScopes:[suffix.toLowerCase()+':write']}, {...operation,id:'createUnreviewed'}]){
   const client=new LifeOSApiClient({origin,credentialProvider:async()=>'synthetic-catalog-key'},async()=>Response.json({apiVersion:'2',operations:[altered]}));
   const args=fromSchema(z.toJSONSchema(argumentSchema(operation)));
   if(altered.id===operation.id){await assert.rejects(client.discover(),/API_CONTRACT_MISMATCH/);assert.equal((await client.execute(operation.id,args)).error,'API_CONTRACT_MISMATCH');}
   else{assert.deepEqual((await client.discover()).operations,[]);assert.equal((await client.execute(operation.id,args)).error,'OPERATION_UNAVAILABLE');}
  }
 }
});

test('new record discovery keeps native normalizers authoritative for semantic constraints before any write',async()=>{
 const f=await fixture();try{
  for(const suffix of ['Media','Career','Portfolio']){
   const schema=f.descriptors.find(op=>op.id==='create'+suffix)!.inputSchema,args=fromSchema(schema);args.idempotencyKey='synthetic-invalid-'+suffix;
   if(suffix==='Media')args.fields.personal.isbn='9780000000000';
   if(suffix==='Career')args.fields.personal.period={startOn:'2020',endOn:'2021',status:'current'};
   if(suffix==='Portfolio')args.fields.personal.balanceMinor='123';
   assertMatches(schema,args);const before=f.writes.length,result=await f.client.callTool({name:'lifeos_call',arguments:{operationId:'create'+suffix,arguments:args}});assert.equal((result.structuredContent as any).status,400);assert.equal(f.writes.length,before);
  }
  const schema=f.descriptors.find(op=>op.id==='createPortfolio')!.inputSchema,args=fromSchema(schema);args.fields.personal.balanceMinor=1.25;assert.equal(validator.getValidator(schema)(args).valid,false);
  const media=f.descriptors.find(op=>op.id==='createMedia')!.inputSchema,input=fromSchema(media);input.fields.personal=fromSchema(media.properties.fields.properties.personal.oneOf[1]);input.fields.personal.progress={unit:'episode',current:1,total:10};assert.equal(validator.getValidator(media)(input).valid,false);
 }finally{await f.close();}
});

test('advertised schemas reject incomplete fields, wrong units, mismatched route metadata and unscoped identity',async()=>{
 const f=await fixture();try{
  const schema=(id:string)=>f.descriptors.find(op=>op.id===id)!.inputSchema;
  const invalid=(id:string,args:unknown)=>assert.equal(validator.getValidator(schema(id))(args).valid,false);
  const args=fromSchema(schema('createFinance'));
  invalid('createFinance',{...args,fields:{}});
  for(const change of [{currency:'USD'},{amountMinor:1.25},{ownerId:'foreign'},{kind:'refund',originalEntryId:null}])invalid('createFinance',{...args,fields:{...args.fields,...change}});
  const org=fromSchema(schema('createOrganization'));invalid('createOrganization',{...org,type:'domain'});
  const update=fromSchema(schema('updateJournal'));delete update.fields.text;invalid('updateJournal',update);
  invalid('getJournal',{id:'00000000-0000-4000-8000-000000000001',ownerId:'foreign'});
  invalid('updateRequirement',{...fromSchema(schema('updateRequirement')),baselineBinding:{}});
 }finally{await f.close();}
});

test('actual Agent todo POST accepts omitted or current relations, rejects null, while PATCH null clears',async()=>{
 const f=await fixture();try{
  const send=async(path:string,method='GET',body?:unknown,key='synthetic-native-todo-key')=>{const response=await f.handler(new Request(origin+'/api/platform/agent'+path,{method,headers:{host:new URL(origin).host,authorization:'Bearer synthetic-native-token','content-type':'application/json','idempotency-key':key},...(body?{body:JSON.stringify(body)}:{})}));return{status:response.status,data:await response.json()};};
  const fields={title:'Synthetic native todo',notes:'Original notes',dueOn:null,status:'open'};
  const nullCreate=await send('/v1/todos','POST',{fields:{...fields,personal:null}},'synthetic-native-null');assert.equal(nullCreate.status,400);assert.equal(nullCreate.data.error,'INVALID_BODY');
  const omitted=await send('/v1/todos','POST',{fields},'synthetic-native-omit');assert.equal(omitted.status,201);assert.equal((await send('/v1/todos/'+omitted.data.entry.id)).data.fields.personal,null);
  const schema=f.descriptors.find(op=>op.id==='createOrganization')!.inputSchema,args=fromSchema(schema);args.idempotencyKey='synthetic-native-project';
  const saved=await f.client.callTool({name:'lifeos_call',arguments:{operationId:'createOrganization',arguments:args}}),project=(saved.structuredContent as any).readback.data;
  const personal={project:{id:project.id,sourceId:project.sourceId,revision:project.revision},domain:null,topics:[]};
  const linked=await send('/v1/todos','POST',{fields:{...fields,personal}},'synthetic-native-linked');assert.equal(linked.status,201);assert.deepEqual((await send('/v1/todos/'+linked.data.entry.id)).data.fields.personal,personal);
  const command={fields:{...fields,personal},idempotencyKey:'synthetic-mcp-real-relations'};assertMatches(f.descriptors.find(op=>op.id==='createTodo')!.inputSchema,command);const mcpLinked=await f.client.callTool({name:'lifeos_call',arguments:{operationId:'createTodo',arguments:command}});assert.equal(mcpLinked.isError,false);assert.deepEqual((mcpLinked.structuredContent as any).readback.data.fields.personal,personal);
  const cleared=await send('/v1/todos/'+linked.data.entry.id,'PATCH',{fields:{...fields,personal:null},expectedRevision:1},'synthetic-native-clear');assert.equal(cleared.status,200);assert.equal(cleared.data.entry.revision,2);assert.equal((await send('/v1/todos/'+linked.data.entry.id)).data.fields.personal,null);
 }finally{await f.close();}
});

test('Todo discovery and parser reject create null without body mutation but retain omit/object/PATCH-null contracts',async()=>{
 const f=await fixture();try{
  const create=agentOperations.find(op=>op.id==='createTodo')!,update=agentOperations.find(op=>op.id==='updateTodo')!;
  const schema=(id:string)=>f.descriptors.find(op=>op.id===id)!.inputSchema;
  const fields={title:'Synthetic MCP todo',notes:'Keep bytes',dueOn:null,status:'open'},key='synthetic-todo-null-contract';
  const bad=Object.freeze({fields:Object.freeze({...fields,personal:null}),idempotencyKey:key});
  assert.equal(validator.getValidator(schema(create.id))(bad).valid,false);
  assert.throws(()=>parseArguments(create,bad),{status:400,code:'INVALID_BODY'});
  assert.deepEqual(bad,{fields:{...fields,personal:null},idempotencyKey:key});
  const before=f.writes.length,denied=await f.client.callTool({name:'lifeos_call',arguments:{operationId:create.id,arguments:bad}});assert.equal((denied.structuredContent as any).error,'INVALID_BODY');assert.equal(f.writes.length,before);
  for(const value of [fields,{...fields,personal:{project:null,domain:null,topics:[]}}]){const args={fields:value,idempotencyKey:key};assertMatches(schema(create.id),args);assert.deepEqual(parseArguments(create,args),{path:'/v1/todos',body:{fields:value},key});}
  const clear={id:'00000000-0000-4000-8000-000000000001',fields:{...fields,personal:null},expectedRevision:1,idempotencyKey:key};assertMatches(schema(update.id),clear);assert.deepEqual(parseArguments(update,clear),{path:'/v1/todos/'+clear.id,body:{fields:clear.fields,expectedRevision:1},key});
 }finally{await f.close();}
});
