import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import * as domain from '../src/personal-health/domain.ts';
import * as presentation from '../src/personal-health/presentation.ts';
import type {HealthPersonal} from '../src/personal-health/domain.ts';

const nativeRequire = createRequire(import.meta.url);
function component(file:string) {
  const path = new URL('../src/personal-health/'+file,import.meta.url);
  if (!existsSync(path)) return null;
  const module = {exports:{} as Record<string,any>};
  const output = ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports',output)((key:string) => {
    if (key.endsWith('.module.css')) return {default:{}};
    if (key === './domain') return domain;
    if (key === './presentation') return presentation;
    return nativeRequire(key);
  },module,module.exports);
  return module.exports;
}
function find(node:unknown,predicate:(node:React.ReactElement<any>) => boolean):React.ReactElement<any>|null {
  if (!React.isValidElement(node)) return null;
  const element = node as React.ReactElement<any>;
  if (predicate(element)) return element;
  for (const child of React.Children.toArray(element.props.children)) {
    const found = find(child,predicate);if (found) return found;
  }
  return null;
}

test('health fields render controlled original units, explicit manual source and disabled inputs', () => {
  const loaded = component('fields.tsx');assert.ok(loaded,'health fields are not implemented');
  const value = presentation.emptyHealthFields('body','Asia/Shanghai').personal;
  if (value.healthKind !== 'body') throw Error('body expected');
  value.weight = {value:180,unit:'lb'};
  const html = renderToStaticMarkup(React.createElement(loaded.HealthFields,{value,onChange:() => {},disabled:true}));
  assert.match(html,/<fieldset[^>]*disabled/);
  assert.match(html,/value="180"/);
  assert.match(html,/<option value="lb" selected="">lb/);
  assert.match(html,/手工记录/);
  assert.match(html,/记录时区/);
  assert.doesNotMatch(html,/已同步|已连接/);
});

test('health field kind changes keep the explicit source and zone without carrying body values into training', () => {
  const loaded = component('fields.tsx');assert.ok(loaded);
  const value = presentation.emptyHealthFields('body','Asia/Shanghai').personal;
  value.source.label = '来自本人纸质笔记';
  let changed:HealthPersonal|null = null;
  const tree = loaded.HealthFields({value,onChange:(next:HealthPersonal) => {changed = next;}});
  const selector = find(tree,node => node.type === 'select' && node.props['aria-label'] === '记录类别');
  assert.ok(selector);selector.props.onChange({target:{value:'training'}});
  assert.ok(changed);
  assert.equal((changed as HealthPersonal).healthKind,'training');
  assert.equal((changed as HealthPersonal).timeZone,'Asia/Shanghai');
  assert.deepEqual((changed as HealthPersonal).source,{kind:'manual',label:'来自本人纸质笔记'});
  assert.equal('weight' in changed,false);
  if ((changed as HealthPersonal).healthKind !== 'training') throw Error('training expected');
  assert.equal((changed as Extract<HealthPersonal,{healthKind:'training'}>).state,'planned');
});

test('health summary renders an honest empty state and separates actual training from plans', () => {
  const loaded = component('summary.tsx');assert.ok(loaded,'health summary is not implemented');
  const empty = renderToStaticMarkup(React.createElement(loaded.HealthEntriesSummary,{entries:[]}));
  assert.match(empty,/暂无健康记录/);assert.doesNotMatch(empty,/0 kg|平均|已同步/);
  const planned = presentation.emptyHealthFields('training','UTC');
  const actual = presentation.emptyHealthFields('training','UTC');
  if (actual.personal.healthKind !== 'training') throw Error('training expected');
  actual.personal.state = 'completed';
  const html = renderToStaticMarkup(React.createElement(loaded.HealthEntriesSummary,{entries:[{id:'plan',revision:1,fields:planned},{id:'actual',revision:2,fields:actual}]}));
  assert.match(html,/已完成训练<\/dt><dd>1<\/dd>/);
  assert.match(html,/训练计划<\/dt><dd>1<\/dd>/);
});

test('health trends keep empty data empty and expose the actual values without requiring a chart', () => {
  const loaded = component('trend.tsx');assert.ok(loaded,'health trend is not implemented');
  const trend = {metric:'weight',series:[],undated:1,missing:2,plannedExcluded:0};
  const empty = renderToStaticMarkup(React.createElement(loaded.HealthTrendView,{trend}));
  assert.doesNotMatch(empty,/role="img"/);assert.match(empty,/没有可绘制/);
  const populated = renderToStaticMarkup(React.createElement(loaded.HealthTrendView,{trend:{...trend,series:[{unit:'lb',points:[{id:'actual',revision:2,date:'2026-11-05',value:180}]}]}}));
  assert.match(populated,/180/);assert.match(populated,/2026-11-05/);assert.match(populated,/lb/);assert.doesNotMatch(populated,/kg/);
});
