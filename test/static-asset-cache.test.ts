import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const {parseUrl}=require('next/dist/shared/lib/router/utils/parse-url.js');
const {getPathMatch}=require('next/dist/shared/lib/router/utils/path-match.js');
const {modifyRouteRegex}=require('next/dist/lib/redirect-status.js');
const {tryToParsePath}=require('next/dist/lib/try-to-parse-path.js');
type Rule={source:string;headers:{key:string;value:string}[]};
async function rules():Promise<Rule[]>{
 const module={exports:{} as {default:{headers:()=>Promise<Rule[]>}}};
 const code=ts.transpileModule(readFileSync('next.config.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',code)((key:string)=>key.includes('build-directory')?{candidateBuildDirectory:()=>'.next'}:require(key),module,module.exports);
 return module.exports.default.headers();
}
const security={
 'x-content-type-options':'nosniff','referrer-policy':'same-origin','x-frame-options':'DENY',
 'content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
test('returned config uses locked native matchers to reserve private cache overrides for non-build paths',async t=>{
 assert.equal(require('next/package.json').version,'16.4.1');
 const actual=await rules(),compiled=actual.map(rule=>{assert.equal(tryToParsePath(rule.source).error,undefined);return{...rule,match:getPathMatch(rule.source,{strict:true,sensitive:false,removeUnnamedParams:true,regexModifier:(regex:string)=>modifyRouteRegex(regex)})};});
 // These are path-policy cases, not fabricated proof that a static file exists or is cacheable.
 const cases:[string,string,boolean][]=[
  ['root','/',true],['login','/login',true],['mfa','/account/mfa',true],['password','/account/password',true],['personal','/personal',true],['edit','/personal/edit?type=todo',true],['api','/api/platform/personal/overview',true],['RSC-shaped page','/personal?_rsc=synthetic',true],['image optimizer','/_next/image?url=%2Fpersonal%2Fprivate.png&w=100&q=75',true],['data route','/_next/data/synthetic/personal.json',true],['public file','/favicon.ico',true],['unknown page','/does-not-exist-synthetic',true],
  ['JS build path','/_next/static/chunks/5994.synthetic.js',false],['CSS build path','/_next/static/css/synthetic.css',false],['JS query','/_next/static/chunks/5994.synthetic.js?synthetic=1',false],['encoded filename','/_next/static/chunks/%35994.synthetic.js',false],['encoded directory','/_next/static/%63hunks/5994.synthetic.js',false],['encoded prefix','/%5Fnext/static/chunks/5994.synthetic.js',true],['lookalike static','/_next/staticity/5994.synthetic.js',true],['lookalike next','/__next/static/chunks/5994.synthetic.js',true],['directory without slash','/_next/static',true],['directory slash','/_next/static/',false],['missing build name','/_next/static/chunks/not-present-synthetic.js',false],['case mismatch','/_NEXT/static/chunks/5994.synthetic.js',false],['encoded prefix slash','/_next/static%2Fchunks/5994.synthetic.js',true],['raw traversal','/_next/static/../../personal',true],['encoded traversal','/_next/static/%2e%2e/%2e%2e/personal',true],['encoded slash traversal','/_next/static/%2e%2e%2f%2e%2e%2fpersonal',false],['double encoding','/_next/static/%252e%252e/personal',false],['malformed encoding','/_next/static/%ZZ',false],
 ];
 for(const [label,url,privatePreset] of cases)await t.test(label,()=>{
  const headers=new Map<string,string>(),pathname=parseUrl(url).pathname;
  for(const rule of compiled)if(rule.match(pathname))for(const h of rule.headers)headers.set(h.key.toLowerCase(),h.value);
  assert.equal(headers.get('cache-control'),privatePreset?'private, no-store':undefined);
  assert.deepEqual(Object.fromEntries([...headers].filter(([key])=>key!=='cache-control')),security);
 });
 assert.equal(actual.length,2);assert.equal(actual.some(rule=>rule.headers.some(h=>h.key.toLowerCase()==='cache-control'&&/public|immutable/.test(h.value))),false,'Real static cache policy belongs to Next filesystem handling');
});
