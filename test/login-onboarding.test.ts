import test from 'node:test';
import assert from 'node:assert/strict';
import type {LoginCapability} from '../src/platform/page-access.ts';

import {renderAuthComponent} from './helpers/auth-component-render.ts';
const render=(capability:LoginCapability)=>renderAuthComponent('src/personal-candidate/login.tsx','LoginPage',{capability});
function accountInput(html:string){const input=(html.match(/<input\b[^>]*>/g)??[]).find(input=>input.includes('name="email"'));assert.ok(input,'The sign-in account field must be present');return input;}

test('personal login offers one short recovery destination without collecting new credentials',()=>{
 const html=render({mode:'personal',enabled:true,ownerAlias:'owner'});
 assert.match(html,/<a href="\/account\/recover">首次设置或忘记密码<\/a>/);
 assert.equal((html.match(/<form\b/g)??[]).length,1);
 assert.equal((html.match(/type="password"/g)??[]).length,1);
 assert.doesNotMatch(html,/autoComplete="new-password"|action="[^"]*(?:reset|register)/i);
});

test('login keeps account password management in the authenticated workspace',()=>{
 const html=render({mode:'personal',enabled:true});
 assert.doesNotMatch(html,/href="\/account\/password"/);
});

test('only a personal capability with an owner alias prefills the existing account',()=>{
 const personal=render({mode:'personal',enabled:true,ownerAlias:'owner'});
 assert.match(accountInput(personal),/type="text"/);
 assert.match(accountInput(personal),/value="owner"/);
 const withoutAlias=render({mode:'personal',enabled:true});
 assert.match(accountInput(withoutAlias),/type="email"/);
 assert.match(accountInput(withoutAlias),/value=""/);
 assert.doesNotMatch(withoutAlias,/\bdan\b/);
 const synthetic=render({mode:'synthetic',enabled:true,ownerAlias:'owner'});
 assert.match(accountInput(synthetic),/type="email"/);
 assert.match(accountInput(synthetic),/value=""/);
 assert.doesNotMatch(synthetic,/\bdan\b/);
});

test('synthetic login retains its warning without personal password-management instructions',()=>{
 const html=render({mode:'synthetic',enabled:true});
 assert.match(html,/登录隔离测试空间/);
 assert.match(html,/仅使用虚构测试身份/);
 assert.doesNotMatch(html,/首次设置|忘记密码|\/account\/password/);
 assert.match(html,/autoComplete="username"/);
 assert.match(html,/autoComplete="current-password"/);
});

test('disabled personal and closed capabilities never collect credentials',()=>{
 for(const capability of [{mode:'personal',enabled:false},{mode:'closed',enabled:false}] as LoginCapability[]){
  const html=render(capability);
  assert.match(html,/当前不能登录或保存/);
  assert.doesNotMatch(html,/<form\b|<input\b/);
 }
});

test('personal login directly offers password and authenticator entry without a standing tutorial',()=>{
 const html=render({mode:'personal',enabled:true,ownerAlias:'owner'});
 assert.match(html,/name="password"/);
 assert.match(html,/name="code"/);
 assert.doesNotMatch(html,/<details|<ol|公司电脑/);
});
