import test from 'node:test';
import assert from 'node:assert/strict';
import {renderAuthComponent as render} from './helpers/auth-component-render.ts';
test('first enrollment has a disabled-until-hydration password form and no pre-rendered secrets',()=>{
 const html=render('src/personal-candidate/owner-mfa-panel.tsx','OwnerMfaPanel',{mode:'start'});
 assert.match(html,/绑定验证器/);assert.match(html,/公司电脑只需要浏览器/);assert.match(html,/<form[^>]*method="post"/);assert.match(html,/<form[^>]*action="\/account\/mfa"/);assert.match(html,/<fieldset disabled/);assert.match(html,/autoComplete="current-password"/);assert.doesNotMatch(html,/otpauth:|mfa-setup-key|<canvas/);
});
test('pending and incomplete enrollment offer a standard one-time-code input without backup bypass',()=>{
 for(const mode of ['verify','incomplete']){const html=render('src/personal-candidate/owner-mfa-panel.tsx','OwnerMfaPanel',{mode});assert.match(html,/autoComplete="one-time-code"/);assert.match(html,/pattern="\[0-9\]\{6\}"/);assert.match(html,/<fieldset disabled/);assert.match(html,/我已妥善保存此前显示的备用恢复码/);assert.match(html,/type="checkbox"/);assert.doesNotMatch(html,/无法使用验证器？使用备用恢复码/);}
});
test('an old session requires relogin and unavailable state collects no credentials',()=>{
 const old=render('src/personal-candidate/owner-mfa-panel.tsx','OwnerMfaPanel',{mode:'relogin'});assert.match(old,/退出.*密码和验证器动态码/);assert.doesNotMatch(old,/<form/);
 const closed=render('src/personal-candidate/owner-mfa-panel.tsx','OwnerMfaPanel',{mode:'unavailable'});assert.match(closed,/私有数据保持关闭/);assert.doesNotMatch(closed,/<form|<input/);
});
test('login challenge offers native backup codes while remaining disabled before hydration',()=>{
 const html=render('src/personal-candidate/mfa-code-form.tsx','MfaCodeForm',{allowBackup:true,onSuccess:()=>{throw Error('SSR cannot verify');}});assert.match(html,/备用恢复码/);assert.match(html,/autoComplete="one-time-code"/);assert.match(html,/<fieldset disabled/);assert.match(html,/<form[^>]*method="post"/);assert.match(html,/<form[^>]*action="\/account\/mfa"/);
});
