import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const require = createRequire(import.meta.url);
function load(file: string): any {
  assert.ok(existsSync(file), 'person fields component is not implemented');
  const module = {exports:{} as any};
  const compiled = ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require','module','exports',compiled)((name: string) => name==='../personal-candidate/relation-fields' ? load('src/personal-candidate/relation-fields.tsx') : require(name),module,module.exports);
  return module.exports;
}
const value = {type:'person',schemaVersion:1,aliases:['示例别名'],phone:null,email:null,birthdayOn:null,birthdayMonthDay:'02-29',company:null,relationship:null,links:{project:null,domain:null,topics:[]}};
function find(element: any, name: string): any {
  if (!element || typeof element!=='object') return null;
  if (element.props?.name===name) return element;
  for (const child of React.Children.toArray(element.props?.children)) {const result=find(child,name);if(result)return result;}
  return null;
}

test('person fields label optional contacts and unknown-year birthdays and inherit a disabled fieldset', () => {
  const {PersonFields}=load('src/personal-people/PersonFields.tsx');
  const html=renderToStaticMarkup(React.createElement(PersonFields,{value,onChange:()=>{},disabled:true,options:{}}));
  assert.match(html,/<fieldset disabled=""/);
  assert.match(html,/电话/);assert.match(html,/邮箱/);assert.match(html,/年份未知/);assert.match(html,/公历/);
  assert.match(html,/所属项目/);assert.match(html,/所属领域/);assert.match(html,/关联主题/);
  assert.doesNotMatch(html,/合成同名|synthetic@example/);
});

test('changing birthday precision clears the other precision and preserves unrelated saved fields', () => {
  const {PersonFields}=load('src/personal-people/PersonFields.tsx');
  let changed: any;
  const tree=PersonFields({value,onChange:(next: any)=>{changed=next;},options:{}});
  find(tree,'personBirthdayOn').props.onChange({target:{value:'2000-02-29'}});
  assert.equal(changed.birthdayOn,'2000-02-29');assert.equal(changed.birthdayMonthDay,null);
  assert.deepEqual(changed.aliases,['示例别名']);assert.deepEqual(changed.links,value.links);
  const full=PersonFields({value:changed,onChange:(next: any)=>{changed=next;},options:{}});
  find(full,'personBirthdayMonthDay').props.onChange({target:{value:'03-01'}});
  assert.equal(changed.birthdayOn,null);assert.equal(changed.birthdayMonthDay,'03-01');
});
