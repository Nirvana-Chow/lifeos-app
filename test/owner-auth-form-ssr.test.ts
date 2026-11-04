import test from 'node:test';
import assert from 'node:assert/strict';
import {renderAuthComponent as render} from './helpers/auth-component-render.ts';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
test('the root renders login directly for anonymous or unavailable identity and redirects only a verified principal',async()=>{
 const native=createRequire(import.meta.url);
 const loginComponent=()=>null;
 for(const [capability,destination] of [[{mode:'personal',enabled:true,ownerAlias:'owner'},'/personal'],[{mode:'synthetic',enabled:true},'/review/admin']] as const)for(const identity of [null,{userId:'synthetic-owner'},new Error('synthetic unavailable')]){
  const module={exports:{} as {default:()=>Promise<any>}};
  const code=ts.transpileModule(readFileSync('app/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports',code)((key:string)=>{
   if(key==='next/headers')return{headers:async()=>new Headers()};
   if(key==='next/navigation')return{redirect:(path:string)=>{throw Error('redirect:'+path);}};
   if(key.includes('/platform/runtime'))return{readPlatformPagePrincipal:async()=>{if(identity instanceof Error)throw identity;return identity;},readPlatformLoginCapability:async()=>capability};
   if(key.includes('/personal-candidate/login'))return{LoginPage:loginComponent};
   return native(key);
  },module,module.exports);
  if(identity&&!(identity instanceof Error))await assert.rejects(module.exports.default(),{message:'redirect:'+destination});
  else{const page=await module.exports.default();assert.equal(page.type,loginComponent);assert.deepEqual(page.props,{capability});}
 }
});
test('enabled login server render disables credentials and uses safe POST fallback',()=>{
 const html=render('src/personal-candidate/login.tsx','LoginPage',{capability:{mode:'personal',enabled:true,ownerAlias:'owner'}});
 assert.match(html,/<main[^>]*data-lifeos-surface="auth"/);
 assert.match(html,/<form[^>]*method="post"/i);assert.match(html,/<form[^>]*action="\/login"/i);assert.match(html,/<fieldset[^>]*disabled[^>]*>[\s\S]*name="email"[\s\S]*name="password"[\s\S]*<button/i);
 assert.match(html,/<input(?=[^>]*name="password")(?=[^>]*autoComplete="current-password")[^>]*>/);
 const code=(html.match(/<input\b[^>]*>/g)??[]).find(input=>input.includes('name="code"'));
 assert.ok(code,'The initial login card must offer the second factor alongside the password');
 assert.match(code,/autoComplete="one-time-code"/);
 assert.doesNotMatch(code,/\brequired(?:=|\s|>)/,'An empty second factor must not block first enrollment');
 assert.equal((html.match(/<form\b/g)??[]).length,1);
});
test('enabled change-password server render disables every credential and uses safe POST fallback',()=>{
 const html=render('src/personal-candidate/password-page.tsx','PasswordPage',{enabled:true,changeOnly:true});
 assert.match(html,/<main[^>]*data-lifeos-surface="auth"/);
 assert.match(html,/<form[^>]*method="post"/i);assert.match(html,/<form[^>]*action="\/account\/password"/i);assert.match(html,/<fieldset[^>]*disabled[^>]*>[\s\S]*name="username"[\s\S]*name="currentPassword"[\s\S]*name="newPassword"[\s\S]*<button/i);
});
test('enabled recovery server render uses the auth surface and keeps credentials disabled',()=>{
 const html=render('src/personal-candidate/owner-recovery-finish-panel.tsx','OwnerRecoveryFinishPanel',{enabled:true,ownerAlias:'owner'});
 assert.match(html,/<main[^>]*data-lifeos-surface="auth"/);assert.match(html,/<form[^>]*method="post"/i);assert.match(html,/<form[^>]*action="\/api\/platform\/personal\/recover-password"/i);assert.match(html,/<fieldset[^>]*disabled[^>]*>[\s\S]*name="otp"[\s\S]*name="newPassword"[\s\S]*name="confirmation"/i);
});
test('embedded account forms delegate dismissal to the settings modal',()=>{
 const password=render('src/personal-candidate/password-page.tsx','PasswordPage',{enabled:true,changeOnly:true,embedded:true});
 assert.doesNotMatch(password,/<main\b|<h1\b/);
 assert.match(password,/<section\b/);
 assert.doesNotMatch(password,/<a[^>]*>取消<\/a>/);
 assert.match(password,/<fieldset[^>]*disabled/);
 const keys=render('src/personal-candidate/account-api-keys.tsx','AccountApiKeys',{embedded:true});
 assert.doesNotMatch(keys,/<main\b|<h1\b|<nav\b|href="\/account\/password"/);
 assert.match(keys,/<section\b/);
});

test('legacy password SSR has one permanently disabled fallback form with native POST target',()=>{
 const html=render('src/personal-candidate/legacy-password-entry.tsx','LegacyPasswordEntry',{enabled:true});
 assert.match(html,/<h1>修改密码<\/h1>/);
 assert.match(html,/<fieldset[^>]*disabled[^>]*data-legacy-password-entry/);
 assert.equal((html.match(/<form\b/g)??[]).length,1);
 assert.match(html,/<form[^>]*method="post"/i);assert.match(html,/<form[^>]*action="\/account\/password"/i);
 for(const name of ['username','currentPassword','newPassword','confirmation'])assert.match(html,new RegExp('name="'+name+'"'));
 assert.doesNotMatch(html,/<input[^>]*type="password"[^>]*value="[^" ]+/i);
});
