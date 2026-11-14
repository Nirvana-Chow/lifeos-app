import test from 'node:test';import assert from 'node:assert/strict';import {renderAuthComponent} from './helpers/auth-component-render.ts';
test('qualified login renders an accessible default30minute picker with day/week/custom/persistent choices',()=>{
 const html=renderAuthComponent('src/personal-candidate/login.tsx','LoginPage',{capability:{mode:'personal',enabled:true,sessionDuration:true}});
 assert.match(html,/这台设备保持登录/);assert.match(html,/<select[^>]*name="sessionDuration"/);for(const label of ['30 分钟（临时登录）','1 天','7 天','自定义','保持登录，直到退出或撤销'])assert.ok(html.includes(label));assert.match(html,/<option[^>]*value="temporary"[^>]*selected/);assert.match(html,/400 天/);
 const closed=renderAuthComponent('src/personal-candidate/login.tsx','LoginPage',{capability:{mode:'personal',enabled:true}});assert.doesNotMatch(closed,/name="sessionDuration"/);
});
