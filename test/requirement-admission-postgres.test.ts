import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PostgresPlatformRepository,type SqlClient} from '../src/platform/postgres.ts';
import {requirementWorkDigestSQL} from '../src/requirement-events/admission-postgres.ts';
const owner='synthetic-admission-owner',space='synthetic-admission-space',id='11111111-1111-4111-8111-111111111111',source='22222222-2222-4222-8222-222222222222',hash='a'.repeat(64);
const projection={spaceId:space,requirementId:id,sourceId:source,revision:1},command={spaceId:space,grantId:'synthetic-grant',key:'synthetic-admission-key'};
function fixture(prior:Record<string,unknown>|null=null,failReceipt=false){
 const calls:{sql:string;values:unknown[]}[]=[];let connects=0,releases=0;
 const client:SqlClient={query:async(sql,values=[])=>{calls.push({sql,values});if(failReceipt&&sql.startsWith('INSERT INTO lifeos_platform.requirement_claim_command'))throw Error('synthetic receipt insertion failure');return{rows:sql.includes(' AS original_digest')?[{original_digest:hash,...prior,observed_at:new Date()}]:sql.includes('requirement_work')&&sql.includes('FOR UPDATE')?(prior?[prior]:[]):[],rowCount:1};},release(){releases++;}};
 const pool={connect:async()=>{assert.equal(connects++,0,'all operations must use the original single checkout');return client;}};
 return{repo:new PostgresPlatformRepository(pool,false,false,undefined,true),closed:new PostgresPlatformRepository(pool),calls,releases:()=>releases};
}
test('canonical work digest matches the unchanged native trigger expression rather than JS serialization',async()=>{
 const sql=await readFile('db/0020_requirement_events.proposed.sql','utf8'),expression=/ wd:=(.+);\n changed:=/.exec(sql)?.[1];assert.ok(expression);assert.equal(requirementWorkDigestSQL,expression.replaceAll('NEW.','r.'));
});
test('admission ports are closed by default; enabled commands and atomic outbox stay on the original transaction checkout',async()=>{
 const closed=fixture();await closed.closed.transaction(owner,command.key,async tx=>{assert.equal(tx.projectRequirementExecution,undefined);assert.equal(tx.admitRequirementExecution,undefined);assert.equal(tx.readRequirementExecutionCommand,undefined);});
 const f=fixture();await f.repo.transaction(owner,command.key,async tx=>{assert.equal(await tx.readRequirementExecutionCommand!(command),null);const work=await tx.projectRequirementExecution!(projection);assert.equal(work.state,'candidate');const result=await tx.admitRequirementExecution!({...command,digest:hash,projection:work});assert.equal(result.admission.state,'ready');assert.equal(Object.hasOwn(result.admission,'leaseActive'),false);});
 const calls=f.calls,at=(text:string)=>calls.findIndex(c=>c.sql.includes(text));assert.equal(f.releases(),1);assert.equal(calls.at(-1)?.sql,'COMMIT');
 assert.deepEqual(calls.find(c=>c.sql==='SELECT pg_advisory_xact_lock(hashtextextended($1,0))'&&c.values[0]===JSON.stringify(['requirement-claim-v1',owner,space,command.grantId,command.key]))?.values,[JSON.stringify(['requirement-claim-v1',owner,space,command.grantId,command.key])]);
 for(const [before,after]of [['AS original_digest',"jsonb_build_array('requirement-events-v1'"],["jsonb_build_array('requirement-events-v1'",'FOR UPDATE'],['FOR UPDATE','INSERT INTO lifeos_platform.requirement_work'],['INSERT INTO lifeos_platform.requirement_work','INSERT INTO lifeos_platform.requirement_event_outbox'],['INSERT INTO lifeos_platform.requirement_event_outbox','pg_notify'],['pg_notify','INSERT INTO lifeos_platform.requirement_claim_command']])assert.ok(at(before)>=0&&at(before)<at(after),before+' precedes '+after);
 assert.ok(calls.every(c=>!c.sql.includes('UPDATE lifeos_platform.platform_record')&&!c.sql.includes('INSERT INTO lifeos_platform.platform_record')));
 assert.deepEqual(calls.find(c=>c.sql.includes("jsonb_build_array('requirement-events-v1'"))?.values,[owner,space]);
});
test('ready no-op emits nothing; exhausted work and failed durable receipt roll back without committing',async()=>{
 const prior={requirement_id:id,source_id:source,record_revision:1,work_digest:hash,dispatch_state:'ready',attempts:2,lease_fence:'2',lease_id:null},f=fixture(prior);
 await f.repo.transaction(owner,command.key,async tx=>{await tx.readRequirementExecutionCommand!(command);const work=await tx.projectRequirementExecution!(projection),result=await tx.admitRequirementExecution!({...command,digest:hash,projection:work});assert.equal(result.admission.attempts,2);assert.equal(result.admission.fence,2);});
 assert.equal(f.calls.some(c=>c.sql.includes('INSERT INTO lifeos_platform.requirement_event_outbox')||c.sql.includes('pg_notify')),false);
 for(const [candidate,failed,code]of [[{...prior,attempts:3},false,'EXECUTION_ATTEMPTS_EXHAUSTED'],[null,true,undefined]] as const){const d=fixture(candidate,failed);const action=d.repo.transaction(owner,command.key,async tx=>{await tx.readRequirementExecutionCommand!(command);const work=await tx.projectRequirementExecution!(projection);return tx.admitRequirementExecution!({...command,digest:hash,projection:work});});if(code)await assert.rejects(action,{code});else await assert.rejects(action,/synthetic receipt insertion failure/);assert.equal(d.calls.at(-1)?.sql,'ROLLBACK');assert.equal(d.calls.some(c=>c.sql==='COMMIT'),false);assert.equal(d.releases(),1);}
});
