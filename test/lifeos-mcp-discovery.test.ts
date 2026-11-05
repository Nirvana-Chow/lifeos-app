import assert from 'node:assert/strict';
import test from 'node:test';
import {Client,InMemoryTransport} from '@modelcontextprotocol/client';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/client/validators/ajv';
import {agentOperations} from '../src/agent-api/capabilities.ts';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {LifeOSApiClient} from '../src/mcp-candidate/client.ts';
import {createLifeOSMcpServer} from '../src/mcp-candidate/tools.ts';
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
async function fixture(){
 const repository=new MemoryPort();repository.readCurrentSnapshot=async()=>structuredClone([...repository.rows.values()]);
 const transaction=repository.transaction.bind(repository);repository.transaction=(owner,key,run)=>transaction(owner,key,tx=>run({...tx,lockRecordIdentity:async()=>{},lockAgentGrant:async()=>true}));
 const grant={grantId:'synthetic-grant',ownerId:'synthetic-owner',spaceId:'synthetic-space',scopes:[...new Set(agentOperations.flatMap(op=>op.requiredScopes))],businessDataPolicy:'all-personal-business-v1' as const,allowedOperationIds:agentOperations.filter(op=>op.module!=='catalog').map(op=>op.id)};
 const handler=createAgentHandler({enabled:true,mountPath:'/api/platform/agent',fenceWrites:true,modules:{organization:true,classification:false,personalRecords:true,businessDataPolicy:true,requirements:true},repository,config:{ownerId:grant.ownerId,spaceId:grant.spaceId,ownerEmail:'fixture@example.invalid',databaseName:'fixture',approval:'personal-manual-v1',allowedTypes:['todo','journal','project','domain','topic'],requirementsEnabled:true,requirementSupportEnabled:true,calendarEnabled:true,healthEnabled:true,peopleEnabled:true,financeEnabled:true,baseURL:origin},verify:async()=>grant,readCurrentGrant:async()=>grant,operationAvailable:()=>true,assertWritable:async()=>{}});
 const requests:string[]=[];
 const api=new LifeOSApiClient({origin,credentialProvider:async()=>'synthetic-injected-key'},async(input,init)=>{const request=new Request(input,init);requests.push(request.method+' '+new URL(request.url).pathname);request.headers.set('host',new URL(request.url).host);return handler(request);});
 const server=createLifeOSMcpServer({client:api}),client=new Client({name:'synthetic-schema-consumer',version:'1'});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(b);await client.connect(a);
 const discover=await client.callTool({name:'lifeos_discover',arguments:{}});assert.equal(discover.isError,false);
 const descriptors=(discover.structuredContent as {operations:Descriptor[]}).operations;
 return{client,descriptors,requests,close:async()=>{await client.close();await server.close();}};
}
// Removing concrete properties/required or the operation/arguments association
// prevents constructing any of these writes from advertised schemas alone.
test('discovery schemas construct native full POST/PATCH bodies and independent GET readback',async()=>{
 const f=await fixture();try{
  const tools=await f.client.listTools(),callSchema=tools.tools.find(t=>t.name==='lifeos_call')!.inputSchema as Schema;
  assert.ok(callSchema.oneOf,'tools/list must pair each operation ID with its arguments');
  for(const suffix of ['Finance','Journal','Calendar','Health','Person','Organization','Requirement','Todo']){
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
  for(const op of f.descriptors)assert.equal(/Media|Career|Portfolio/.test(op.id),false);
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
