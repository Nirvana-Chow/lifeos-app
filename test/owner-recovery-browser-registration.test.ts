import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

/** Execute the real declarations only; no test body, browser, DB or owner code runs. */
function declarations(env:Record<string,string>){
 const source=ts.createSourceFile('owner-recovery-browser.integration.test.ts',readFileSync(new URL('./owner-recovery-browser.integration.test.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const stripped=ts.factory.updateSourceFile(source,source.statements.filter(s=>!ts.isImportDeclaration(s)));
 const input=ts.createPrinter().printFile(stripped).replaceAll('import.meta.dirname','"/synthetic-source"');
 const code=ts.transpileModule(input,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const rows:{name:string;skip:boolean}[]=[],inert=()=>{throw Error('OWNER_BODY_EXECUTION_FORBIDDEN');};
 vm.runInNewContext(code,{process:{env},test:(name:string,options:unknown)=>{const o=options&&typeof options==='object'?options as {skip?:unknown}:{};rows.push({name,skip:!!o.skip});},verifyPrivateRouteBoundaries:inert,verifyPrivateAppearanceAndDrafts:inert,verifyPrivatePresentationMatrix:inert},{timeout:1000});
 return rows;
}
const auth='OPT-IN public auth theme oracle follows approved shared palette';
const full=[
 'no-JS page lifecycle finishes and closes before the next page opens',
 'isolated browser owner recovery and password flow',
 'isolated private business route boundaries',
 'isolated private appearance and draft lifecycle',
 'isolated private business presentation matrix',
];
test('default browser declarations keep the standalone auth oracle explicitly skipped',()=>{
 const rows=declarations({});assert.equal(rows.length,6);assert.equal(rows.find(r=>r.name===auth)?.skip,true);assert.equal(rows.filter(r=>r.skip).length,5);
});
test('early explicit auth mode still registers and enables its actual standalone oracle',()=>{
 const rows=declarations({RUN_AUTH_THEME_FIXTURE_BROWSER_TESTS:'1'});assert.equal(rows.length,6);assert.equal(rows.find(r=>r.name===auth)?.skip,false);assert.equal(rows.find(r=>r.name===full[1])?.skip,true);
});
test('full owner mode registers exactly the original five cases with no extra skipped oracle',()=>{
 const rows=declarations({RUN_OWNER_RECOVERY_BROWSER_TESTS:'1'});assert.deepEqual(rows.map(r=>r.name),full);assert.equal(rows.some(r=>r.skip),false);
});
