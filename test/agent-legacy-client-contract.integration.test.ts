import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createAgentHandler} from '../src/agent-api/http.ts';
import {MemoryPort} from './helpers/platform.ts';

test('OPT-IN compiled reviewed Swift client accepts unchanged todo catalogs with policy off and on',{
 skip:process.env.RUN_AGENT_LEGACY_SWIFT_CONTRACT_TESTS!=='1'&&'Explicit reviewed Swift Core fixture not provided',timeout:45000,
},async()=>{
 const core=process.env.LIFEOS_LEGACY_SWIFT_CORE;
 assert.ok(core&&isAbsolute(core)&&core.endsWith('/Core.swift'));
 const source=await readFile(core);
 assert.equal(createHash('sha256').update(source).digest('hex'),'a9a0deda2910064830c9d89e698b2a65b3f15a80ca2ad8d17ee6fb1b99d906f2');
 const root=await mkdtemp('/private/tmp/lifeos-legacy-contract-');
 await writeFile(join(root,'main.swift'),`import Foundation
import CoreFoundation
for path in CommandLine.arguments.dropFirst() {
 do {
  let found=try catalog(Data(contentsOf:URL(fileURLWithPath:path)),expectedVersion:"2")
  for id in ["createTodo","updateTodo"] {
   guard found.operations.contains(where:{$0.id==id && $0.scopes == ["todo:write"]}) else { print("missing-known-write");exit(1) }
  }
 } catch { print("strict-known-contract-rejected: \\(error)");exit(1) }
}
print("compiled-reviewed-Core: policy-off and policy-on todo contracts accepted")
`);
 const executable=join(root,'known-contract-fixture');
 const compiled=spawnSync('swiftc',[core,join(root,'main.swift'),'-o',executable],{encoding:'utf8',timeout:30000});
 assert.equal(compiled.status,0,compiled.stderr);
 const config={ownerId:'synthetic-owner',ownerEmail:'fixture@example.test',spaceId:'synthetic-space',baseURL:'http://127.0.0.1:3190',databaseName:'fixture',approval:'personal-manual-v1',allowedTypes:['todo']} as const;
 const paths:string[]=[];
 for(const policy of [false,true]){
  const grant={grantId:'synthetic-grant',ownerId:config.ownerId,spaceId:config.spaceId,scopes:['todo:read','todo:write'] as const,...(policy?{businessDataPolicy:'all-personal-business-v1' as const,allowedOperationIds:['listTodos','snapshotTodos','getTodo','createTodo','updateTodo']}:{})};
  const handler=createAgentHandler({enabled:true,config,repository:new MemoryPort(),...(policy?{modules:{organization:false,classification:false,businessDataPolicy:true}}:{}),verify:async()=>grant,readCurrentGrant:async()=>grant,operationAvailable:()=>true,assertWritable:async()=>{}});
  const response=await handler(new Request(config.baseURL+'/v2/capabilities',{headers:{host:'127.0.0.1:3190',authorization:'Bearer synthetic-fixture'}}));assert.equal(response.status,200);
  const path=join(root,policy?'policy-on.json':'policy-off.json');await writeFile(path,await response.text());paths.push(path);
 }
 const result=spawnSync(executable,paths,{encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stdout+result.stderr);
 assert.match(result.stdout,/policy-off and policy-on todo contracts accepted/);
 const drift=JSON.parse(await readFile(paths[0],'utf8')) as {operations:{id:string;requiredScopes:string[]}[]};
 drift.operations.find(op=>op.id==='createTodo')!.requiredScopes=['todo:read','todo:write'];
 const driftPath=join(root,'rejected-contract-drift.json');await writeFile(driftPath,JSON.stringify(drift));
 const rejected=spawnSync(executable,[driftPath],{encoding:'utf8',timeout:10000});assert.equal(rejected.status,1);assert.match(rejected.stdout,/scope-contract-mismatch/);
});
