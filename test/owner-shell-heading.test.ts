import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {hasOwnerShellHeading} from './helpers/owner-shell-heading.ts';

test('owner shell heading accepts plain native h1 for every protected page',()=>{
 for(const heading of ['总览','待办','修改密码']){
  const html=renderToStaticMarkup(createElement('main',null,createElement('h1',null,heading)));
  assert.equal(hasOwnerShellHeading(html,heading),true);
 }
});

test('owner shell heading accepts the React SSR focus-restoration attribute',()=>{
 const html=renderToStaticMarkup(createElement('main',null,createElement('h1',{tabIndex:-1},'总览')));
 assert.equal(hasOwnerShellHeading(html,'总览'),true);
});

test('owner shell heading accepts native attributes without changing the exact text contract',()=>{
 const html=renderToStaticMarkup(createElement('h1',{id:'page-heading',className:'heading',tabIndex:-1,'aria-label':'总览'},'待办'));
 assert.equal(hasOwnerShellHeading(html,'待办'),true);
 assert.equal(hasOwnerShellHeading(html,'总览'),false);
});

test('owner shell heading rejects wrong or partial heading text',()=>{
 for(const text of ['待办','总览记录',' 总览','总览 ']){
  const html=renderToStaticMarkup(createElement('h1',{tabIndex:-1},text));
  assert.equal(hasOwnerShellHeading(html,'总览'),false);
 }
});

test('owner shell heading rejects a different native level or an ARIA-only heading',()=>{
 for(const element of [createElement('h2',null,'总览'),createElement('div',{role:'heading','aria-level':1},'总览')]){
  assert.equal(hasOwnerShellHeading(renderToStaticMarkup(element),'总览'),false);
 }
});

test('owner shell heading rejects missing headings and escaped h1 text',()=>{
 for(const element of [createElement('main',null,'总览'),createElement('p',null,'<h1>总览</h1>')]){
  assert.equal(hasOwnerShellHeading(renderToStaticMarkup(element),'总览'),false);
 }
});
