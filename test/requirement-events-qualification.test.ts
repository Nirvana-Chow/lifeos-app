import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {verifyRequirementEventReadiness,requirementEventTriggerDigest} from '../src/requirement-events/readiness.ts';
import {readAgentBusinessModules} from '../src/agent-api/config.ts';
test('event module requires explicit requirements activation and exact schema readiness; malformed metadata closes',async()=>{
 assert.equal(readAgentBusinessModules({},null).requirementEvents,undefined);
 assert.throws(()=>readAgentBusinessModules({LIFEOS_AGENT_REQUIREMENT_EVENTS:'requirement-events-v1'},null));
 const personal={requirementsEnabled:true} as never;assert.equal(readAgentBusinessModules({LIFEOS_AGENT_REQUIREMENT_EVENTS:'requirement-events-v1',LIFEOS_AGENT_REQUIREMENTS:'requirements-v1'},personal).requirementEvents,true);
 for(const key of ['role_safe','tables_safe','trigger_safe','sequence_safe'])await assert.rejects(verifyRequirementEventReadiness({query:async()=>({rows:[{role_safe:true,tables_safe:true,trigger_safe:true,sequence_safe:true,[key]:false}]})}),{code:'REQUIREMENT_EVENTS_UNAVAILABLE'});
 const sql=readFileSync('db/0020_requirement_events.proposed.sql','utf8'),marker=sql.indexOf('CREATE FUNCTION lifeos_platform.capture_requirement_event'),start=sql.indexOf('AS $$',marker)+5,end=sql.indexOf('$$;',start);
 assert.equal(createHash('sha256').update(sql.slice(start,end)).digest('hex'),requirementEventTriggerDigest);
});
test('event platform migration never reads or writes the Auth private registry and registration stays closed',()=>{
 const platform=readFileSync('db/0020_requirement_events.proposed.sql','utf8');
 assert.doesNotMatch(platform,/lifeos_agent\./,'Platform owner must not need Auth schema usage or private table rights');
 const policy=readFileSync('db/0020_requirement_events_agent_operations.proposed.sql','utf8');
 assert.match(policy,/lifeos\.agent_expected_database/);assert.match(policy,/lifeos\.agent_expected_owner/);assert.match(policy,/lifeos\.agent_expected_space/);
 assert.match(policy,/lifeos_agent\.key_management_binding/);assert.match(policy,/lifeos_agent\.business_policy_operation/);
 assert.doesNotMatch(policy,/GRANT\s|ALTER\s+.*OWNER|UPDATE\s+lifeos_agent/i);
 assert.deepEqual([...policy.matchAll(/\('([A-Za-z]+)',ARRAY\[([^\]]+)\],false\)/g)].map(match=>[match[1],match[2]]),[
  ['streamRequirementEvents',"'requirements:read'"],['claimRequirementExecution',"'requirements:read','requirements:write'"],['updateRequirementExecution',"'requirements:read','requirements:write'"],
 ]);
});
test('actual requirements/event JUnit gate rejects missing event coverage, skips, duplicates and errors',()=>{
 const names=['concurrent first overlays lock one deterministic identity and second different key sees CAS conflict','create restart readback update history and lost committed response recover exact command','new issuer mode has independently verified native scopes and fence rejects revoked requirements grants','OPT-IN requirement transaction outbox rollback, receipt dedupe and lease fence on restricted PostgreSQL'];
 const directory=mkdtempSync(join(tmpdir(),'lifeos-event-junit-'));
 try{for(const path of ['qualification.yml','visual-qualification.yml']){
  const workflow=readFileSync('.github/workflows/'+path,'utf8'),match=workflow.match(/python3 - <<'PY_REQUIREMENTS_PG'\n([\s\S]*?)\n          PY_REQUIREMENTS_PG/);assert.ok(match);
  const code=match[1].split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
  for(const mutation of ['none','missing-event','duplicate','skipped','failure','error']){
   const rows=[...names];if(mutation==='missing-event')rows.pop();if(mutation==='duplicate')rows[3]=rows[2];writeFileSync(join(directory,'requirements-pg.xml'),'<testsuite>'+rows.map((name,i)=>`<testcase name="${name}">${i===0&&['skipped','failure','error'].includes(mutation)?`<${mutation}/>`:''}</testcase>`).join('')+'</testsuite>');
   const result=spawnSync('python3',['-c',code],{env:{...process.env,RUNNER_TEMP:directory},encoding:'utf8'});assert.equal(result.status===0,mutation==='none',mutation+result.stderr);
  }
 }}finally{rmSync(directory,{recursive:true,force:true});}
});
