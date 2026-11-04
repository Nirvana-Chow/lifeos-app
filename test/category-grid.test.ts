import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as tanstack from '@tanstack/react-table';
import ts from 'typescript';

const native = createRequire(import.meta.url);
/** Real React/ReUI/TanStack execution; CSS is inert and initial filter state is controlled. */
function renderProjection(path: string, name: string, props: Record<string, unknown>, initialStates: Record<number, unknown> = {}) {
  const tables: any[] = [];
  const cache = new Map<string, any>();
  const root = resolve(path);
  let stateIndex = 0;
  function load(file: string): any {
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} as any };
    cache.set(file, module.exports);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    new Function('require', 'module', 'exports', code)((key: string) => {
      if (key.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, name) => String(name) }) };
      if (key === 'react' && file === root) return {
        ...React,
        useState(value: any) {
          const index = stateIndex++;
          return React.useState(index in initialStates ? initialStates[index] : value);
        },
      };
      if (key === '@tanstack/react-table') return {
        ...tanstack,
        useTable(options: any) { const table = tanstack.useTable(options); tables.push(table); return table; },
      };
      if (!key.startsWith('.')) return native(key);
      const base = resolve(dirname(file), key);
      const found = [base, base + '.tsx', base + '.ts'].find(candidate => existsSync(candidate));
      if (!found) throw Error('Missing component dependency: ' + key);
      return load(found);
    }, module, module.exports);
    return module.exports;
  }
  const component = load(root)[name];
  const html = renderToStaticMarkup(React.createElement(component, props));
  return { html, tables };
}
const areas = [{ id: 'a', revision: 2, title: 'Health' }, { id: 'b', revision: 3, title: 'Learning' }];
const projects = [
  { id: 'p-b', revision: 7, title: 'B walking', area: areas[0], stage: 'active', nextStep: 'Walk', referenceChanged: true },
  { id: 'p-a', revision: 4, title: 'A reading', area: areas[1], stage: 'paused', nextStep: null },
];
const tasks = [
  { id: 't1', project: projects[0], area: areas[0], status: 'open' },
  { id: 't2', project: projects[0], area: areas[0], status: 'done' },
  { id: 't3', project: projects[0], area: areas[0], status: 'cancelled' },
  { id: 't4', project: null, area: areas[0], status: 'in_progress' },
];
const props = {kind: 'projects', areas, projects, tasks, coverage: 'complete', writable: true, onViewTasks() {}};
const render = (extra = {}) => renderProjection('src/ui-review/category-grid.tsx', 'CategoryGrid', { ...props, ...extra });
const ids = (table: any) => table.getRowModel().rows.map((row: any) => row.id);
function cellElement(table: any, rowId: string, columnId: string) {
  const cell = table.getCoreRowModel().rows.find((row: any) => row.id === rowId).getAllCells().find((cell: any) => cell.column.id === columnId);
  return cell.column.columnDef.cell(cell.getContext());
}
function elements(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  return [node, ...React.Children.toArray(node.props?.children).flatMap(elements)];
}

test('category projects use native table filtering/sorting, stable identities and exact pending counts', () => {
  const {tables, html} = render();
  const table = tables[0];
  assert.equal(tables.length, 1);
  assert.deepEqual(table.getAllLeafColumns().map((column: any) => column.id), ['title', 'area', 'stage', 'nextStep', 'pending', 'actions']);
  assert.deepEqual(ids(table), ['p-b', 'p-a']);
  assert.equal(table.getRowModel().rows[0].original.revision, 7);
  assert.equal(table.getRowModel().rows[0].getValue('pending'), 1);
  assert.equal(table.getRowModel().rows[0].getValue('stage'), '进行中');
  assert.match(renderToStaticMarkup(cellElement(table, 'p-b', 'title')), /关联待核对/);
  table.getColumn('title').toggleSorting(false);
  assert.deepEqual(ids(table), ['p-a', 'p-b']);
  table.getColumn('area').setFilterValue('a');
  assert.deepEqual(ids(table), ['p-b']);
  table.getColumn('stage').setFilterValue('paused');
  assert.deepEqual(ids(table), []);
  table.getColumn('area').setFilterValue(undefined);
  assert.deepEqual(ids(table), ['p-a']);
  table.getColumn('stage').setFilterValue(undefined);
  table.getColumn('title').setFilterValue('WALK');
  assert.deepEqual(ids(table), ['p-b']);
  assert.equal(table.getColumn('title').getCanResize(), true);
  table.setColumnSizing({ title: 350 });
  assert.equal(table.getColumn('title').getSize(), 350);
  assert.equal(table.options.onCellsChange, undefined);
  assert.match(html, /新建项目/);
});

test('areas count each pending task once and partial coverage never presents exact aggregates', () => {
  const complete = render({kind: 'areas'}).tables[0];
  assert.deepEqual(complete.getAllLeafColumns().map((column: any) => column.id), ['title', 'projects', 'pending', 'actions']);
  assert.equal(complete.getRowModel().rows[0].getValue('projects'), 1);
  assert.equal(complete.getRowModel().rows[0].getValue('pending'), 2);
  const partial = render({kind: 'areas', coverage: 'partial'});
  assert.equal(partial.tables[0].getRowModel().rows[0].getValue('projects'), null);
  assert.equal(partial.tables[0].getRowModel().rows[0].getValue('pending'), null);
  assert.match(renderToStaticMarkup(cellElement(partial.tables[0], 'a', 'pending')), /—/);
  assert.match(partial.html, /范围不完整/);
  const empty = render({projects: []});
  assert.equal(empty.tables[0].getRowModel().rows.length, 0);
  assert.match(empty.html, /没有符合条件的项目/);
});

test('separate view-task action and guarded editor links preserve authority and readonly access', () => {
  const views: any[] = [];
  const navigations: string[] = [];
  const result = render({onViewTasks: (...args: any[]) => views.push(args), onNavigate: (href: string) => { navigations.push(href); return false; }});
  const nodes = elements(cellElement(result.tables[0], 'p-b', 'actions'));
  const view = nodes.find(node => node.props?.children === '查看待办');
  view.props.onClick();
  assert.deepEqual(views, [[null, 'p-b']]);
  const edit = nodes.find(node => node.type === 'a');
  assert.equal(edit.props.href, '/personal/edit?type=project&id=p-b');
  let prevented = false;
  edit.props.onClick({preventDefault() { prevented = true; }});
  assert.equal(prevented, true);
  assert.deepEqual(navigations, ['/personal/edit?type=project&id=p-b']);
  const readonly = render({writable: false});
  assert.doesNotMatch(readonly.html, /新建项目/);
  assert.equal(elements(cellElement(readonly.tables[0], 'p-b', 'actions')).some(node => node.type === 'a'), false);
  const area = render({kind: 'areas', onViewTasks: (...args: any[]) => views.push(args)});
  const areaNodes = elements(cellElement(area.tables[0], 'a', 'actions'));
  areaNodes.find(node => node.props?.children === '查看待办').props.onClick();
  assert.deepEqual(views[1], ['a', null]);
  assert.equal(areaNodes.find(node => node.type === 'a').props.href, '/personal/edit?type=domain&id=a');
});

test('project totals remain unknown on partial snapshots and large tables retain every category', () => {
  const partial = render({coverage: 'partial'}).tables[0];
  assert.equal(partial.getRowModel().rows[0].getValue('pending'), null);
  const many = render({projects: Array.from({length: 130}, (_, index) => ({...projects[0], id: 'project-' + index, title: 'Project ' + index}))}).tables[0];
  many.getColumn('title').toggleSorting(true);
  assert.equal(many.getRowModel().rows.length, 130);
  assert.equal(new Set(ids(many)).size, 130);
});

test('editor links encode category identities and an accepted guard allows native navigation', () => {
  const result = render({projects: [{...projects[0], id: 'p /?&'}], onNavigate: () => true});
  const edit = elements(cellElement(result.tables[0], 'p /?&', 'actions')).find(node => node.type === 'a');
  assert.equal(edit.props.href, '/personal/edit?type=project&id=p%20%2F%3F%26');
  let prevented = false;
  edit.props.onClick({preventDefault() { prevented = true; }});
  assert.equal(prevented, false);
});
