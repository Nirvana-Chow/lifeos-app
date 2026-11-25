import ts from 'typescript';
import test from'node:test';import assert from'node:assert/strict';import{execFileSync}from'node:child_process';import{readFileSync}from'node:fs';
test('default-disabled real runtime returns503 without falling back to fixture or a production URL',()=>{
 const script=`const m=await import('./src/platform/runtime.ts');const r=await m.handlePlatformRequest(new Request('http://127.0.0.1:3190/api/platform/todos'));console.log(JSON.stringify({status:r.status,body:await r.json()}));`;
 for(const activation of ['0','1']){const output=execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),env:{PATH:process.env.PATH,NODE_ENV:'test',LIFEOS_PLATFORM_CANDIDATE:activation,DATABASE_URL:'postgres://fixture.invalid/not-allowed'},encoding:'utf8'});const r=JSON.parse(output);assert.equal(r.status,503);assert.equal(r.body.error.code,'PLATFORM_UNAVAILABLE');assert.doesNotMatch(output,/fixture\.invalid|password|secret/i);}
});
test('proposed migration is isolated, owner-scoped and unapplied; has no account or role bootstrap',()=>{
 const sql=readFileSync(new URL('../db/0001_platform_candidate.sql',import.meta.url),'utf8');assert.match(sql,/current_database\(\).*lifeos_platform_test_/);assert.equal((sql.match(/ENABLE ROW LEVEL SECURITY/g)??[]).length,4);assert.equal((sql.match(/FORCE ROW LEVEL SECURITY/g)??[]).length,4);assert.equal((sql.match(/WITH CHECK\(owner_id=current_setting/g)??[]).length,4);assert.doesNotMatch(sql,/CREATE\s+(ROLE|USER)|DROP\s|TRUNCATE\s|INSERT INTO lifeos_platform\.platform_user/i);assert.match(sql,/FOREIGN KEY\(owner_id,original_entry_id\)/);assert.match(sql,/GRANT UPDATE\(draft,revision,updated_at,original_entry_id\)/);
});


test('the public platform route presents its unavailable code without isolation diagnostics',async()=>{
 const module={exports:{} as Record<string,(request:Request)=>Promise<Response>>};
 const source=readFileSync(new URL('../app/api/platform/[[...resource]]/route.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 const headers={'cache-control':'private, no-store',vary:'Cookie'};
 let response=Response.json({error:{code:'PLATFORM_UNAVAILABLE',message:'Synthetic runtime configuration diagnostic'}},{status:503,headers});
 new Function('require','module','exports',code)((path:string)=>{
  assert.ok(path.endsWith('/platform/runtime'));
  return {handlePlatformRequest:async()=>response};
 },module,module.exports);
 const request=new Request('https://fixture.invalid/api/platform/personal/status');
 const unavailable=await module.exports.GET(request);
 assert.equal(unavailable.status,503);
 assert.equal(unavailable.headers.get('cache-control'),'private, no-store');
 assert.equal(unavailable.headers.get('vary'),'Cookie');
 assert.deepEqual(await unavailable.json(),{error:{code:'PLATFORM_UNAVAILABLE',message:'服务暂不可用，请稍后重试。'}});
 response=Response.json({error:{code:'PERSONAL_SNAPSHOT_UNAVAILABLE',message:'原有错误'}},{status:503,headers});
 assert.equal(await module.exports.GET(request),response);
 response=new Response('upstream temporarily unavailable',{status:503,headers:{'content-type':'application/json'}});
 assert.equal(await module.exports.GET(request),response);
 response=Response.json({error:{code:'OWNER_ONLY'}},{status:403,headers});
 assert.equal(await module.exports.GET(request),response);
});
