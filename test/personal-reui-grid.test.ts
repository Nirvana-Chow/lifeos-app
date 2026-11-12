import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { flexRender } from '@tanstack/react-table';
import { TaskCellDraftMemory } from '../src/personal-candidate/task-cell-draft.ts';
import { taskStatusLabels } from '../src/personal-candidate/task-editor-state.ts';

const fields = { title: 'Original', text: 'Notes', date: '', status: 'open' };
const task = (id: string, revision: number) => ({ id, revision, title: id, status: 'open', dueOn: null, project: null, area: null });
function harness() {
  let cursor = 0;
  const states: any[] = [];
  const effects: Function[] = [];
  const react = {
    createContext(value: any) { const context: any = { current: value }; context.Provider = { context }; return context; },
    useContext(context: any) { return context.current; },
    useRef(value: unknown) { const i = cursor++; return states[i] ??= { current: value }; },
    useState(value: any) { const i = cursor++; if (!(i in states)) states[i] = typeof value === 'function' ? value() : value; return [states[i], (next: any) => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; },
    useMemo(fn: Function) { cursor++; return fn(); },
    useCallback(fn: Function) { cursor++; return fn; },
    useEffect(fn: Function) { cursor++; effects.push(fn); },
  };
  const jsx = { jsx: (type: unknown, props: any) => ({ type, props }), jsxs: (type: unknown, props: any) => ({ type, props }) };
  let options: any;
  const imports: Record<string, any> = {
    react, 'react/jsx-runtime': jsx,
    '@tanstack/react-table': { useTable: (input: any) => {
      options = input;
      return { getRowModel: () => ({ rows: input.data.map((original: any) => ({ id: original.id, original })) }), setFocusedCell() {}, getHeaderGroups: () => [], state: {}, store: {} };
    } },
    './reui/data-grid': { DataGrid: 'grid', DataGridContainer: 'container', dataGridFeatures: {} },
    './reui/data-grid-table-virtual': { DataGridTableVirtual: 'virtual' },
    './reui/data-grid-cell-selection': { DataGridCellSelection: 'selection' },
    './ui/button': { Button: 'button' },
    '../personal-candidate/task-editor-state': { taskStatusLabels },
    '../personal-candidate/task-grid-editor': { mountTaskGridEditor: () => { throw Error('input effects must be exercised by the editor behavior suite'); } },
    './task-grid.module.css': { default: new Proxy({}, { get: (_, key) => String(key) }) },
  };
  const code = ts.transpileModule(readFileSync(new URL('../src/ui-review/task-grid.tsx', import.meta.url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', 'window', code)((key: string) => { assert.ok(key in imports, 'unexpected dependency ' + key); return imports[key]; }, module, module.exports, { confirm: () => false });
  const find = (node: any, predicate: (value: any) => boolean): any => {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    for (const child of Array.isArray(node) ? node : [node.props?.children]) { const result = find(child, predicate); if (result) return result; }
    return null;
  };
  return { render(props: any) { cursor = 0; effects.length = 0; const tree = module.exports.TaskGrid(props); const provider = find(tree, node => !!node.type?.context); if (provider) provider.type.context.current = provider.props.value; return tree; }, options: () => options, find, effects: () => effects.splice(0).forEach(fn => fn()) };
}

test('grid resolves edits by stable id from latest props and rejects fabricated row metadata', () => {
  const h = harness(); const memory = new TaskCellDraftMemory(); memory.verify({ ownerId: 'owner', spaceId: 'space' });
  const props = { tasks: [task('b', 8), task('a', 4)], writable: true, onOpen() {}, onSave: async () => null, getTaskFields: () => fields, draftMemory: memory };
  let tree = h.render(props); const grid = h.find(tree, n => n.type === 'grid');
  grid.props.onCellEditRequest({ rowId: 'a', columnId: 'title', row: task('wrong', 99) });
  tree = h.render(props);
  const title = h.options().columns.find((column: any) => column.id === 'title');
  const cell = title.cell({ row: { id: 'a', original: task('a', 4) }, column: { id: 'title' }, getValue: () => 'a' });
  assert.equal(cell.props.edit.task.id, 'a'); assert.equal(cell.props.edit.task.revision, 4);
  assert.equal(cell.props.edit.fields.title, 'Original');
  assert.equal(h.options().getRowId(task('a', 4)), 'a');
  assert.equal(h.options().initialState.pagination.pageSize, 2);
  assert.equal(grid.props.onCellsChange, undefined);
});

test('grid preserves retained original revision and does not start writers in readonly or blocked states', () => {
  const h = harness(); const memory = new TaskCellDraftMemory(); memory.verify({ ownerId: 'owner', spaceId: 'space' });
  memory.claim({ id: 'a', revision: 2 }, 'title', () => true)!({ task: { id: 'a', revision: 2 }, fields: fields as any, field: 'title', value: 'Retained Chinese 中文' });
  const props = { tasks: [task('a', 4)], writable: true, onOpen() {}, onSave: async () => null, getTaskFields: () => fields, draftMemory: memory };
  let tree = h.render(props); h.find(tree, n => n.type === 'grid').props.onCellEditRequest({ rowId: 'a', columnId: 'title' });
  tree = h.render(props); let cell = h.options().columns[0].cell({ row: { id: 'a', original: task('a', 4) }, column: { id: 'title' }, getValue: () => 'a' });
  assert.equal(cell.props.edit.task.revision, 2); assert.equal(cell.props.edit.value, 'Retained Chinese 中文');
  for (const blockedProps of [{ writable: false }, { blocked: true }, { onSave: undefined }]) {
    const fresh = harness(); const t = fresh.render({ ...props, ...blockedProps });
    fresh.find(t, n => n.type === 'grid').props.onCellEditRequest({ rowId: 'a', columnId: 'title' });
    fresh.render({ ...props, ...blockedProps });
    cell = fresh.options().columns[0].cell({ row: { id: 'a', original: task('a', 4) }, column: { id: 'title' }, getValue: () => 'a' });
    assert.equal(cell.type, 'span');
  }
});


test('real React cell element type stays stable when saving or uncertain changes blocked', () => {
  const h = harness();
  const props = { tasks: [task('a', 4)], writable: true, blocked: false, onOpen() {}, onSave: async () => null, getTaskFields: () => fields };
  h.render(props);
  const context = { row: { id: 'a', original: task('a', 4) }, column: { id: 'title' }, getValue: () => 'a' } as any;
  const first = flexRender(h.options().columns[0].cell, context) as any;
  h.render({ ...props, blocked: true, writable: false });
  const blocked = flexRender(h.options().columns[0].cell, context) as any;
  assert.equal(typeof first.type, 'function');
  assert.equal(blocked.type, first.type, 'React must preserve the mounted cell/editor across access state changes');
});

test('native type-to-edit initialText enters the scoped real edit target instead of dropping the first character', () => {
  const h = harness(); const memory = new TaskCellDraftMemory(); memory.verify({ ownerId: 'owner', spaceId: 'space' });
  const props = { tasks: [task('a', 4)], writable: true, onOpen() {}, onSave: async () => null, getTaskFields: () => fields, draftMemory: memory };
  const tree = h.render(props);
  h.find(tree, n => n.type === 'grid').props.onCellEditRequest({ rowId: 'a', columnId: 'title', initialText: '待' });
  h.render(props);
  const cell = h.options().columns[0].cell({ row: { id: 'a', original: task('a', 4) }, column: { id: 'title' }, getValue: () => 'a' });
  assert.equal(cell.props.edit.value, '待');
  assert.deepEqual(cell.props.edit.task, { id: 'a', revision: 4 });
});

test('typing to resume a retained title preserves its existing scoped text instead of replacing it', () => {
  const h = harness(); const memory = new TaskCellDraftMemory(); memory.verify({ ownerId: 'owner', spaceId: 'space' });
  memory.claim({ id: 'a', revision: 2 }, 'title', () => true)!({ task: { id: 'a', revision: 2 }, fields: fields as any, field: 'title', value: '未提交' });
  const props = { tasks: [task('a', 4)], writable: true, onOpen() {}, onSave: async () => null, getTaskFields: () => fields, draftMemory: memory };
  const tree = h.render(props); h.find(tree, n => n.type === 'grid').props.onCellEditRequest({ rowId: 'a', columnId: 'title', initialText: '新' });
  h.render(props);
  const cell = h.options().columns[0].cell({ row: { id: 'a', original: task('a', 4) }, column: { id: 'title' }, getValue: () => 'a' });
  assert.equal(cell.props.edit.value, '未提交新'); assert.equal(memory.read()?.value, '未提交新'); assert.equal(memory.read()?.task.revision, 2);
});

test('native column handles can resize below their starting widths without changing records', () => {
 const h=harness();
 const tree=h.render({tasks:[task('a',4)],writable:true,onOpen(){},onSave:async()=>null,getTaskFields:()=>fields});
 const grid=h.find(tree,n=>n.type==='grid');
 assert.equal(grid.props.tableLayout.columnsResizable,true);
 assert.equal(grid.props.tableLayout.columnsResizeMode,'onEnd');
 for(const column of h.options().columns.filter((c:any)=>c.id!=='complete')){
  assert.ok(column.minSize<column.size);
 }
 assert.deepEqual(h.options().data,[task('a',4)]);
});

test('the required title column opts into native auto sizing while meaningful columns remain available', () => {
 const h=harness();
 h.render({tasks:[task('a',4)],writable:false,onOpen(){}});
 const columns=h.options().columns;
 assert.deepEqual(columns.filter((column:any)=>column.meta.autoSize).map((column:any)=>column.id),['title']);
 assert.deepEqual(columns.map((column:any)=>column.id),['complete','title','status','due','project','area','detail']);
 assert.equal(h.options().state.columnVisibility.title,undefined,'the content column remains visible by default');
});

test('table completion sends the original identity and remains disabled without write permission', () => {
 const h=harness(),calls:unknown[]=[];
 const props={tasks:[task('a',4)],writable:true,onOpen(){},onSetTaskStatus:(...args:unknown[])=>calls.push(args)};
 h.render(props);
 const column=h.options().columns.find((c:any)=>c.id==='complete');
 assert.ok(column,'A visible completion action must be present');
 const cell=column.cell({row:{id:'a',original:task('a',4)},column:{id:'complete'}});
 assert.equal(cell.props.disabled,false);
 cell.props.onClick();
 assert.deepEqual(calls,[[{id:'a',revision:4},'done']]);
 h.render({...props,writable:false});
 assert.equal(column.cell({row:{id:'a',original:task('a',4)},column:{id:'complete'}}).props.disabled,true);
});
