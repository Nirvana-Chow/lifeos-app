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
const entry = (id: string, type: string, title: string, personal: any = undefined) => ({
  id, revision: 4,
  draft: type === 'todo' ? { title, notes: '', dueOn: null, status: 'open', personal } : { title, text: '', occurredOn: null, personal: personal ?? { type } },
  source: { id: 'source-' + id, original: { marker: 'personal-manual-v1', spaceId: 'space', type } },
});
const entries = [
  entry('domain-b', 'domain', 'B health'),
  entry('domain-a', 'domain', 'A learning'),
  entry('project-b', 'project', 'B project', { type: 'project', stage: 'active', purpose: 'maintain', nextStep: 'Walk', domain: { id: 'domain-b', sourceId: 'source-domain-b', revision: 4 }, topics: [] }),
  entry('todo-a', 'todo', 'A task', { project: { id: 'project-b', sourceId: 'source-project-b', revision: 4 }, domain: null, topics: [] }),
];

test('persisted projection renders real readonly grid with original ids, fixed columns and sortable titles/domains', () => {
  const { html, tables } = renderProjection('src/personal-candidate/persistent-views.tsx', 'PersistentViews', { entries, spaceId: 'space', documentNavigation: true });
  assert.equal(tables.length, 1, 'projection must mount the shared ReUI table, independently of chart loading');
  const table = tables[0];
  assert.deepEqual(table.getRowModel().rows.map((row: any) => row.id), ['domain-b', 'domain-a', 'project-b', 'todo-a']);
  assert.deepEqual(table.getAllLeafColumns().map((column: any) => column.id), ['kind', 'title', 'domain', 'project', 'status', 'stage']);
  assert.equal(table.getColumn('status').getCanSort(), false);
  assert.equal(table.getColumn('title').getCanSort(), true);
  assert.equal(table.getColumn('domain').getCanSort(), true);
  table.getColumn('title').toggleSorting(false);
  assert.deepEqual(table.getRowModel().rows.map((row: any) => row.id), ['domain-a', 'todo-a', 'domain-b', 'project-b']);
  table.getColumn('domain').toggleSorting(false);
  assert.deepEqual(table.getRowModel().rows.map((row: any) => row.id), ['project-b', 'todo-a', 'domain-b', 'domain-a']);
  assert.equal(table.getRowModel().rows.find((row: any) => row.id === 'project-b').original.revision, 4);
  assert.equal(table.getRowModel().rows.find((row: any) => row.id === 'todo-a').getValue('project'), 'B project');
  assert.match(html, /href="\/personal\/edit\?type=project&amp;id=project-b"/);
  assert.match(html, /下一步：Walk/);
  assert.match(html, /ECharts 持久化记录统计/);
  assert.equal(table.options.onCellsChange, undefined);
});

test('domain-id and kind filters keep grid, statistics and cards aligned and respect locked navigation', () => {
  const { html, tables } = renderProjection('src/personal-candidate/persistent-views.tsx', 'PersistentViews', { entries, spaceId: 'space', navigationLocked: true, documentNavigation: true }, { 0: 'domain-b', 1: '待办' });
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].getRowModel().rows.map((row: any) => row.id), ['todo-a']);
  assert.equal((html.match(/<article/g) ?? []).length, 1);
  assert.doesNotMatch(html, /href="\/personal\/edit/);
  assert.match(html, /1 项任务/);
  const empty = renderProjection('src/personal-candidate/persistent-views.tsx', 'PersistentViews', { entries: [], spaceId: 'space', layoutOnly: true });
  assert.equal(empty.tables[0].getRowModel().rows.length, 0);
  assert.match(empty.html, /当前筛选没有记录，不计算完成率/);
  assert.match(empty.html, /未加载账户或业务数据/);
});

test('shared readonly RecordGrid keeps synthetic IDs, sortable fixed columns and no save writer', () => {
  const rows = [
    { id: 'synthetic-b', kind: '任务', title: 'B task', domain: 'Health', project: 'Project', status: '未完成' },
    { id: 'synthetic-a', kind: '任务', title: 'A task', domain: 'Health', project: 'Project', status: '完成' },
  ];
  const { html, tables } = renderProjection('src/ui-review/record-grid.tsx', 'RecordGrid', { rows, projection: 'synthetic' });
  assert.equal(tables.length, 1);
  const table = tables[0];
  assert.deepEqual(table.getRowModel().rows.map((row: any) => row.id), ['synthetic-b', 'synthetic-a']);
  assert.deepEqual(table.getAllLeafColumns().map((column: any) => column.id), ['kind', 'title', 'domain', 'project', 'status']);
  table.getColumn('title').toggleSorting(false);
  assert.deepEqual(table.getRowModel().rows.map((row: any) => row.id), ['synthetic-a', 'synthetic-b']);
  assert.equal(table.getRowModel().rows[0].getValue('project'), 'Project');
  assert.equal(table.getColumn('domain').getCanSort(), true);
  assert.equal(table.getColumn('status').getCanSort(), false);
  assert.equal(table.options.onCellsChange, undefined);
  assert.match(html, /data-record-grid="reui"/);
});

test('readonly projection keeps every filtered source row beyond the default table page size', () => {
  const entries = Array.from({ length: 130 }, (_, index) => entry('record-' + index, 'todo', 'Task ' + index));
  const { tables } = renderProjection('src/personal-candidate/persistent-views.tsx', 'PersistentViews', { entries, spaceId: 'space', documentNavigation: true });
  assert.equal(tables[0].getRowModel().rows.length, 130);
  tables[0].getColumn('title').toggleSorting(true);
  assert.equal(tables[0].getRowModel().rows.length, 130);
  assert.equal(new Set(tables[0].getRowModel().rows.map((row: any) => row.id)).size, 130);
  assert.equal(tables[0].getRowModel().rows[0].id, 'record-129');
});
