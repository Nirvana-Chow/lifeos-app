import test from 'node:test';
import assert from 'node:assert/strict';
import {renderAuthComponent} from './helpers/auth-component-render.ts';

test('public layout renders caller content without the original owner filing identity',()=>{
 const html=renderAuthComponent('app/layout.tsx','default',{children:'Public workspace content'});
 assert.match(html,/Public workspace content/);
 assert.equal(/ICP备|网站备案|beian\.miit\.gov\.cn/.test(html),false,"public layout contains an owner-specific filing identity");
});
