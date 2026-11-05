import test from 'node:test';
import assert from 'node:assert/strict';
import {RequirementMutationSession,makeRequirementCommand} from '../src/requirements-candidate/client.ts';
const binding={ownerId:'requirements-owner',spaceId:'requirements-space'},fields={title:'Synthetic draft',body:'Private input',phaseId:'foundation',priority:'P3',plannedStartOn:null,plannedEndOn:null} as const;
const id='00000000-0000-4000-8000-000000000001',sourceId='00000000-0000-4000-8000-000000000002';
const item=(revision=1)=>({id,sourceId,revision,fields:{...fields,title:'Synthetic draft'},baselineBinding:null,baselineConflict:false,requirement:{}});
function store(){const values=new Map<string,string>();return{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);},values};}
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
test('requirements client freezes exact unknown command and recovers receipt plus authoritative get before clearing secondary retention',async()=>{
 const storage=store(),calls:{url:string;body:string|null;key:string|null}[]=[],command=makeRequirementCommand(binding,null,fields,'requirements-client-command');let fail=true;
 const session=new RequirementMutationSession({binding,storage,fetcher:async(url,init)=>{calls.push({url,body:init?.body as string??null,key:new Headers(init?.headers).get('idempotency-key')});if(fail){fail=false;throw Error('unknown response');}return url.endsWith('/'+id)?response({entry:item()}):response({entry:item(),duplicate:true});}});
 await session.submit(command);assert.equal(session.getSnapshot().phase,'uncertain');assert.equal(storage.values.size,1);
 (fields as {title:string}).title='Changed mutable input';await session.retry();(fields as {title:string}).title='Synthetic draft';
 assert.equal(calls[0].body,calls[1].body);assert.equal(calls[0].key,calls[1].key);assert.equal(calls[2].url,'/api/platform/personal/requirements/'+id);assert.equal(session.getSnapshot().phase,'saved');assert.equal(storage.values.size,0);
});
test('receipt alone, unreadable readback, cancelled or changed-owner replies remain unknown and never claim saved',async()=>{
 for(const problem of ['readback','foreign','abort']){
  const storage=store();let active=true,session:RequirementMutationSession;
  session=new RequirementMutationSession({binding,storage,assertBinding:()=>active,fetcher:async(url)=>{if(problem==='foreign'){active=false;return response({entry:item(),duplicate:false});}if(problem==='abort'){session.cancel();return response({entry:item(),duplicate:false});}if(url.endsWith('/'+id))throw Error('read failed');return response({entry:item(),duplicate:false});}});
  await session.submit(makeRequirementCommand(binding,null,fields,'requirements-unknown-'+problem));assert.equal(session.getSnapshot().phase,'uncertain');assert.equal(session.getSnapshot().saved,null);assert.equal(storage.values.size,1);
 }
});
test('rejected initial conflict clears command but unknown replay rejection retains the original frozen command',async()=>{
 const s=store(),initial=new RequirementMutationSession({binding,storage:s,fetcher:async()=>response({error:{code:'REVISION_CONFLICT'}},409)});
 await initial.submit(makeRequirementCommand(binding,null,fields,'requirements-initial-conflict'));assert.equal(initial.getSnapshot().phase,'rejected');assert.equal(s.values.size,0);
 let lost=true;const second=new RequirementMutationSession({binding,storage:s,fetcher:async()=>{if(lost){lost=false;throw Error();}return response({error:{code:'BASELINE_CONFLICT'}},409);}});
 await second.submit(makeRequirementCommand(binding,null,fields,'requirements-replay-conflict'));await second.retry();assert.equal(second.getSnapshot().phase,'uncertain');assert.equal(s.values.size,1);
});
test('recovery is scoped to owner and space; denied secondary storage prevents a new write; immutable extra fields rejected',async()=>{
 const storage=store(),first=new RequirementMutationSession({binding,storage,fetcher:async()=>{throw Error();}});await first.submit(makeRequirementCommand(binding,null,fields,'requirements-retained-1'));
 const resumed=new RequirementMutationSession({binding,storage});assert.equal(resumed.getSnapshot().phase,'uncertain');
 const foreign=new RequirementMutationSession({binding:{...binding,ownerId:'another-owner'},storage});assert.equal(foreign.getSnapshot().phase,'idle');
 let calls=0;const denied=new RequirementMutationSession({binding,storage:{getItem:()=>null,setItem:()=>{throw Error();},removeItem:()=>{}},fetcher:async()=>{calls++;return response({});}});
 await denied.submit(makeRequirementCommand(binding,null,fields,'requirements-denied-1'));assert.equal(calls,0);assert.equal(denied.getSnapshot().phase,'rejected');
 assert.throws(()=>makeRequirementCommand(binding,null,{...fields,evidence:[]} as typeof fields,'requirements-forged-1'));
});

test('old PATCH omission accepts preserved workflow and unknown retry rereads newer workflow without changing its command',async()=>{
 const workflow={state:'in_progress',purpose:'保存业务用途',nextStep:'继续当前需求'},newer={...workflow,state:'blocked',nextStep:'等待资料'},storage=store(),calls:string[]=[];
 const command=makeRequirementCommand(binding,id,fields,'requirements-workflow-old-patch',1,null);let lost=true;
 const session=new RequirementMutationSession({binding,storage,fetcher:async(url,init)=>{if(init?.method==='PATCH'){calls.push(String(init.body));if(lost){lost=false;throw Error('lost after commit');}return response({entry:{...item(2),fields:{...fields,workflow}},duplicate:true});}return response({entry:{...item(3),fields:{...fields,workflow:newer}}});}});
 await session.submit(command);assert.equal(session.getSnapshot().phase,'uncertain');await session.retry();assert.equal(session.getSnapshot().phase,'saved');assert.equal(calls[0],calls[1]);assert.equal(JSON.parse(calls[0]).fields.workflow,undefined);assert.equal(session.getSnapshot().observed!.fields.workflow?.state,'blocked');assert.equal(storage.values.size,0);
});
test('explicit workflow command survives retained recovery and requires exact workflow in its receipt and same-revision readback',async()=>{
 const workflow={state:'planned',purpose:'保存用途',nextStep:'下一步'} as const,command=makeRequirementCommand(binding,null,{...fields,workflow},'requirements-workflow-new-command');
 for(const mismatch of ['receipt','readback']){
  const storage=store(),session=new RequirementMutationSession({binding,storage,fetcher:async(url)=>response(url.endsWith('/'+id)?{entry:{...item(),fields:{...fields,workflow:{...workflow,purpose:mismatch==='readback'?'wrong':workflow.purpose}}}}:{entry:{...item(),fields:{...fields,workflow:{...workflow,purpose:mismatch==='receipt'?'wrong':workflow.purpose}}},duplicate:false})});
  await session.submit(command);assert.equal(session.getSnapshot().phase,'uncertain');assert.equal(storage.values.size,1);assert.deepEqual(new RequirementMutationSession({binding,storage}).getSnapshot().pending!.body.fields.workflow,workflow);
  const resumed=new RequirementMutationSession({binding,storage,fetcher:async(url)=>response(url.endsWith('/'+id)?{entry:{...item(),fields:{...fields,workflow}}}:{entry:{...item(),fields:{...fields,workflow}},duplicate:true})});await resumed.retry();assert.equal(resumed.getSnapshot().phase,'saved');assert.deepEqual(resumed.getSnapshot().observed!.fields.workflow,workflow);assert.equal(storage.values.size,0);
 }
});
