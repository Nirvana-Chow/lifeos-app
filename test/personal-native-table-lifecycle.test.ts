import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import ts from'typescript';
import * as gridEditorModule from '../src/personal-candidate/task-grid-editor.ts';
import{PersonalWorkspaceController}from'../src/personal-candidate/workspace-controller.ts';import*as editorModule from'../src/personal-candidate/editor.ts';import*as stateModule from'../src/personal-candidate/task-editor-state.ts';import*as draftModule from'../src/personal-candidate/task-cell-draft.ts';
const secondId='33333333-3333-4333-8333-333333333333';
const id='11111111-1111-4111-8111-111111111111',sourceId='22222222-2222-4222-8222-222222222222';const flush=async()=>{for(let i=0;i<8;i++)await new Promise<void>(r=>setImmediate(r));};
function fixture(){let owner='fixture-owner',space='fixture-space',writable=true,mode:'save'|'reject'|'unknown'='save',revision=3,title='Original',notes='Body',gate:Promise<void>|null=null,release:()=>void=()=>{},second=false;const storage=new Map<string,string>(),requests:any[]=[],receipts=new Map<string,any>();
 const entry=()=>({id,kind:'todo',draft:{title,notes,dueOn:null,status:'open'},source:{id:sourceId,system:'website',externalId:id,version:1,asOf:'2026-10-27T00:00:00Z',original:{marker:'personal-manual-v1',spaceId:space,type:'todo',input:{}}},revision,syncState:'draft',externalStatus:null});
 const fetcher:typeof fetch=async(input,init)=>{const path=String(input);if(path.endsWith('/availability'))return Response.json({configured:true,loginAllowed:true,https:true});if(path.endsWith('/status'))return Response.json({scope:'personal-manual-candidate',ownerId:owner,spaceId:space,storageVerified:true,writable,allowedTypes:['todo']});if(path.includes('/overview'))return Response.json({items:[entry(),...(second?[{...entry(),id:secondId,draft:{...entry().draft,title:'Original B'},source:{...entry().source,id:'44444444-4444-4444-8444-444444444444',externalId:secondId}}]:[])],total:second?2:1,scope:'full-current-snapshot',truncated:false,today:new URL(path,'https://fixture.invalid').searchParams.get('today'),observedAt:'2026-10-27T00:00:00Z'});if(path.endsWith('/todo/'+id)&&init?.method==='PATCH'){const key=new Headers(init.headers).get('idempotency-key')!,body=JSON.parse(String(init.body));requests.push({key,body});if(gate)await gate;if(mode==='reject')return Response.json({error:{code:'INVALID_PERSONAL_FIELDS'}},{status:400});const duplicate=receipts.has(key);if(!duplicate){title=body.fields.title;notes=body.fields.notes;revision=body.expectedRevision+1;receipts.set(key,{...entry(),draft:body.fields});}if(mode==='unknown'){mode='save';throw Error('lost receipt');}return Response.json({entry:receipts.get(key),duplicate});}throw Error('unexpected '+path);};
 return{addSecond(){second=true;},fetcher,storage,requests,mode:(v:typeof mode)=>mode=v,hold(){gate=new Promise<void>(r=>release=r);},release(){gate=null;release();},writable:(v:boolean)=>writable=v,remoteEdit(){revision++;title='Newer remote title';},changeBinding(which:'owner'|'space'){if(which==='owner')owner='other-owner';else space='other-space';title='Other binding';}};
}
function harness(f: ReturnType<typeof fixture>) {
  let changed = false, actions: any, visibleTable = true, allowDiscard = false, confirms = 0;
  let gridProps: any, tableOptions: any, mounted = false, rowsVisible = true, inputElement: Element | null = null, optimisticWrites = 0;
  const excluded = new Set<string>();
  type Effect = { run: () => void | (() => void); deps?: any[]; cleanup?: () => void; pending: boolean };
  function hooks() {
    let cursor = 0;
    const values: any[] = [], effects = new Map<number, Effect>();
    const same = (a: any[] | undefined, b: any[] | undefined) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
    return {
      reset() { cursor = 0; },
      react: {
        createContext(value: any) { const context: any = { current: value }; context.Provider = { context }; return context; },
        useContext(context: any) { return context.current; },
        useRef(value: any) { const i = cursor++; return values[i] ??= { current: value }; },
        useState(value: any) { const i = cursor++; if (!(i in values)) values[i] = typeof value === 'function' ? value() : value; return [values[i], (next: any) => { const value = typeof next === 'function' ? next(values[i]) : next; if (!Object.is(value, values[i])) { values[i] = value; changed = true; } }]; },
        useMemo(fn: Function, deps: any[]) { const i = cursor++; if (!values[i] || !same(deps, values[i].deps)) values[i] = { deps, value: fn() }; return values[i].value; },
        useCallback(fn: Function, deps: any[]) { return this.useMemo(() => fn, deps); },
        useEffect(run: Effect['run'], deps?: any[]) { const i = cursor++, prior = effects.get(i); if (!prior || !same(deps, prior.deps)) effects.set(i, { run, deps, cleanup: prior?.cleanup, pending: true }); },
      },
      effects() { for (const e of effects.values()) if (e.pending) { e.pending = false; e.cleanup?.(); e.cleanup = e.run() || undefined; } },
      dispose() { for (const e of effects.values()) e.cleanup?.(); effects.clear(); values.length = 0; },
    };
  }
  const hostHooks = hooks(), tableHooks = hooks(), childHooks = new Map<string, ReturnType<typeof hooks>>();
  let currentHooks = tableHooks;
  const listeners = new Map<string, Set<Function>>();
  class Element {
    style: any = {}; value = ''; disabled = false; className = ''; type = ''; attrs = new Map<string, string>();
    events = new Map<string, Set<Function>>();
    tagName: string;
    constructor(tagName: string) { this.tagName = tagName; }
    addEventListener(key: string, fn: Function) { if (!this.events.has(key)) this.events.set(key, new Set()); this.events.get(key)!.add(fn); }
    removeEventListener(key: string, fn: Function) { this.events.get(key)?.delete(fn); }
    fire(key: string, event: any = {}) { for (const fn of this.events.get(key) ?? []) fn({ target: this, preventDefault() {}, stopPropagation() {}, ...event }); }
    focus() { document.activeElement = this; }
  }
  const listen = { addEventListener(key: string, fn: Function) { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key)!.add(fn); }, removeEventListener(key: string, fn: Function) { listeners.get(key)?.delete(fn); } };
  const document = { ...listen, activeElement: null as Element | null, visibilityState: 'visible' };
  const window = { ...listen, location: { origin: 'https://fixture.invalid' }, sessionStorage: { getItem: (key: string) => f.storage.get(key) ?? null, setItem: (key: string, value: string) => f.storage.set(key, value), removeItem: (key: string) => f.storage.delete(key) }, confirm: () => { confirms++; return allowDiscard; } };
  const jsx = { jsx: (type: unknown, props: any, key?: unknown) => ({ type, props, key }), jsxs: (type: unknown, props: any, key?: unknown) => ({ type, props, key }), Fragment: 'fragment' };
  function load(path: URL, imports: any) {
    const module = { exports: {} as any }, code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', 'window', 'document', 'fetch', code)((key: string) => { assert.ok(key in imports, 'unexpected ' + key); return imports[key]; }, module, module.exports, window, document, f.fetcher);
    return module.exports;
  }
  const dom = new Map<string, Element>();
  // Only framework rendering/model boundaries are represented here. All LifeOS components,
  // native editor events, real parent/controller, command storage and receipt memory execute.
  // Upstream ReUI/TanStack layout, selection and virtualization require the isolated browser gate.
  const react = new Proxy({}, { get: (_, key: keyof typeof tableHooks.react) => currentHooks.react[key].bind(currentHooks.react) });
  const tableModule = load(new URL('../src/ui-review/task-grid.tsx', import.meta.url), {
    react, 'react/jsx-runtime': jsx,
    '@tanstack/react-table': { useTable: (options: any) => { tableOptions = options; return { getRowModel: () => ({ rows: options.data.map((original: any) => ({ id: original.id, original })) }) }; } },
    './reui/data-grid': { DataGrid: 'grid', DataGridContainer: 'container', dataGridFeatures: {} },
    './reui/data-grid-table-virtual': { DataGridTableVirtual: 'virtual' },
    './reui/data-grid-cell-selection': { DataGridCellSelection: 'selection' },
    './ui/button': { Button: 'button' },
    './task-grid.module.css': { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) },
    '../personal-candidate/task-editor-state': stateModule,
    '../personal-candidate/task-grid-editor': gridEditorModule,
  });
  const hostModule = load(new URL('../src/personal-candidate/connected-workspace.tsx', import.meta.url), { 'react/jsx-runtime': jsx, react: hostHooks.react, 'react-dom': { flushSync: (fn: () => void) => fn() }, './workspace-controller': { PersonalWorkspaceController }, './task-editor': { TaskEditor: () => null }, './task-editor.module.css': { default: {} }, './editor': editorModule, './task-editor-state': stateModule, './task-cell-draft': draftModule });
  let visited = new Set<string>();
  function visit(node: any, path = 'root') {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((child, index) => visit(child, `${path}/${child?.key ?? index}`)); return; }
    if (typeof node.type === 'function') {
      const key = `${path}/${node.type.name}`; visited.add(key);
      let component = childHooks.get(key); if (!component) { component = hooks(); childHooks.set(key, component); }
      const previous = currentHooks; currentHooks = component; component.reset(); visit(node.type(node.props), key); currentHooks = previous; return;
    }
    if (node.type?.context) node.type.context.current = node.props.value;
    if (node.type === 'grid') gridProps = node.props;
    if (node.type === 'virtual' && rowsVisible) {
      for (const task of tableOptions.data) for (const column of tableOptions.columns) {
        visit(column.cell({ row: { id: task.id, original: task }, column: { id: column.id }, getValue: () => column.accessorFn(task) }), `row-${task.id}/column-${column.id}`);
      }
    }
    if (node.type === 'selection') node.props.apiRef.current = { focusCell() {} };
    if (node.type === 'input' || node.type === 'select') {
      const key = path + '/' + node.type; visited.add(key);
      let element = dom.get(key); if (!element) { element = new Element(node.type); element.value = node.props.defaultValue ?? ''; dom.set(key, element); }
      element.className = node.props.className; element.type = node.props.type ?? '';
      element.attrs.set('aria-label', node.props['aria-label']);
      if (typeof node.props.ref === 'function') node.props.ref(element); else if (node.props.ref) node.props.ref.current = element;
      inputElement = element;
    }
    visit(node.props?.children, path + '/children');
  }
  function disposeTable() {
    for (const component of childHooks.values()) component.dispose(); childHooks.clear(); tableHooks.dispose(); dom.clear(); mounted = false; inputElement = null;
  }
  function render() {
    for (let i = 0; i < 12; i++) {
      changed = false; hostHooks.reset(); hostModule.ConnectedPersonalWorkspace({ children: (props: any) => { actions = props; return null; } });
      if (actions.state.status === 'ready' && visibleTable) {
        mounted = true; tableHooks.reset(); currentHooks = tableHooks; visited = new Set(); inputElement = null;
        const tasks = actions.state.data.tasks.filter((task: any) => !excluded.has(task.id) && (task.status === 'open' || task.status === 'in_progress')).map((task: any) => new Proxy(task, { set(target, key, value) { optimisticWrites++; return Reflect.set(target, key, value); } }));
        visit(tableModule.TaskGrid({ tasks, writable: actions.access.writable && !actions.saving && !actions.uncertain, blocked: actions.saving || actions.uncertain, onSave: actions.onSaveTask, getTaskFields: actions.getTaskFields, draftMemory: actions.taskCellDraftMemory, onOpen() {} }));
        for (const [key, component] of childHooks) if (!visited.has(key)) { component.dispose(); childHooks.delete(key); }
        for (const key of dom.keys()) if (!visited.has(key)) dom.delete(key);
        for (const component of childHooks.values()) component.effects();
        tableHooks.effects();
      } else if (mounted) disposeTable();
      hostHooks.effects(); if (!changed) return;
    }
    throw Error('render loop');
  }
  const table = {
    get records() { return tableOptions?.data.map((row: any) => ({ ...row, _id: row.id })) ?? []; },
    startEditCell(column: number, row: number, initialText?: string) { const task = tableOptions.data[row - 1]; if (!task) return; gridProps.onCellEditRequest({ rowId: task.id, columnId: ['title', 'status', 'due'][column], initialText }); render(); },
    async complete() { inputElement?.fire('keydown', { key: 'Enter' }); await flush(); render(); },
  };
  return {
    render, table: () => table, actions: () => actions, input: () => inputElement,
    activeElement: () => document.activeElement,
    confirm(value: boolean) { allowDiscard = value; }, confirms: () => confirms,
    exclude(taskId: string) { excluded.add(taskId); render(); },
    setTable(show: boolean) { visibleTable = show; render(); },
    setRenderedRows(show: boolean) { rowsVisible = show; render(); },
    unload() { let prevented = 0; for (const fn of listeners.get('beforeunload') ?? []) fn({ preventDefault: () => prevented++, returnValue: undefined }); return prevented; },
    type(value: string) { assert.ok(inputElement); inputElement.value = value; inputElement.fire('input'); },
    hidden() { document.visibilityState = 'hidden'; for (const fn of listeners.get('visibilitychange') ?? []) fn(); render(); },
    visible() { document.visibilityState = 'visible'; for (const fn of listeners.get('visibilitychange') ?? []) fn(); render(); },
    dispose() { disposeTable(); hostHooks.dispose(); }, localWrites: () => optimisticWrites,
  };
}
async function ready(f:ReturnType<typeof fixture>){const h=harness(f);h.render();await flush();h.render();await flush();h.render();return h;}
test('real parent rerenders and ReUI native inputs retain invalid/rejected text then commit only receipts',async()=>{const f=fixture(),h=await ready(f);h.table().startEditCell(0,1);h.type(' ');await h.table().complete();h.render();assert.equal(h.input()?.value,' ');assert.equal(f.requests.length,0);h.type('Corrected');f.mode('reject');await h.table().complete();h.render();assert.equal(h.input()?.value,'Corrected');assert.equal(h.input()?.disabled,false);assert.equal(f.requests[0].body.expectedRevision,3);f.mode('save');await h.table().complete();h.render();assert.equal(h.input(),null);assert.equal(f.requests[1].body.expectedRevision,3);assert.equal(h.actions().state.data.tasks[0].title,'Corrected');assert.equal(h.localWrites(),0);h.dispose();});
test('hidden native draft restores only after verified same binding and never autosubmits',async()=>{const f=fixture(),h=await ready(f);h.table().startEditCell(0,1);h.type('Unsubmitted');h.hidden();assert.equal(h.input(),null);assert.equal(f.requests.length,0);h.visible();await flush();h.render();await flush();h.render();assert.equal(h.input()?.value,'Unsubmitted');assert.equal(f.requests.length,0);assert.equal(f.storage.size,0);h.dispose();});
test('owner/space changes discard native drafts and readonly/saving never start a new writer',async()=>{for(const binding of['owner','space']as const){const f=fixture(),h=await ready(f);h.table().startEditCell(0,1);h.type('Old private text');h.hidden();f.changeBinding(binding);h.visible();await flush();h.render();await flush();h.render();assert.equal(h.input(),null);assert.equal(f.requests.length,0);h.dispose();}const f=fixture(),h=await ready(f);h.table().startEditCell(0,1);h.type('Held');f.hold();const pending=h.table().complete();await flush();h.render();assert.equal(h.input()?.disabled,true);await h.table().complete();assert.equal(f.requests.length,1);f.release();await pending;h.render();assert.equal(h.localWrites(),0);h.hidden();f.writable(false);h.visible();await flush();h.render();await flush();h.render();h.table().startEditCell(0,1);assert.equal(h.input(),null);h.dispose();});
test('unknown native save locks input and recovers its original key without a second native write',async()=>{const f=fixture(),h=await ready(f);h.table().startEditCell(0,1);h.type('Unknown title');f.mode('unknown');await h.table().complete();h.render();assert.equal(h.input()?.value,'Unknown title');assert.equal(h.input()?.disabled,true);assert.equal(h.actions().uncertain,true);await h.table().complete();assert.equal(f.requests.length,1);h.hidden();h.visible();await flush();h.render();await flush();h.render();assert.equal(h.input(),null);await h.actions().onRetryTaskMutation();h.render();assert.equal(h.input(),null);assert.equal(h.actions().uncertain,false);assert.deepEqual(f.requests[0],f.requests[1]);assert.equal(f.storage.size,0);assert.equal(h.localWrites(),0);h.dispose();});

test('restored cell keeps its original revision on newer rows and retains text across readonly verification',async()=>{const f=fixture(),h=await ready(f);h.table().startEditCell(0,1);h.type('Original revision draft');h.hidden();f.remoteEdit();h.visible();await flush();h.render();await flush();h.render();assert.equal(h.input()?.value,'Original revision draft');await h.table().complete();h.render();assert.equal(h.input()?.value,'Original revision draft');assert.equal(f.requests.length,0);assert.match(h.actions().mutationError,/版本/);h.hidden();f.writable(false);h.visible();await flush();h.render();await flush();h.render();assert.equal(h.input(),null);assert.equal(h.actions().taskCellDraftMemory.read().task.revision,3);h.hidden();f.writable(true);h.visible();await flush();h.render();await flush();h.render();assert.equal(h.input()?.value,'Original revision draft');assert.equal(f.requests.length,0);h.dispose();});

test('same-host table unmount preserves draft and document leave is guarded until explicit native cancel',async()=>{const f=fixture(),h=await ready(f);h.table().startEditCell(0,1);h.type('Switch-view draft');h.setTable(false);assert.equal(h.input(),null);assert.equal(h.unload(),1);h.setTable(true);await flush();h.render();assert.equal(h.input()?.value,'Switch-view draft');assert.equal(f.requests.length,0);h.input()!.fire('keydown',{key:'Escape'});h.render();assert.equal(h.input(),null);assert.equal(h.unload(),0);assert.equal(f.storage.size,0);h.dispose();});

test('ReUI date/select editors save ISO/raw status and cannot write an old row after receipt filters it away',async()=>{const f=fixture(),h=await ready(f);h.table().startEditCell(2,1);assert.equal(h.input()?.value,'');h.type('2026-11-09');await h.table().complete();h.render();assert.equal(f.requests[0].body.fields.dueOn,'2026-11-09');assert.equal(h.input(),null);h.table().startEditCell(1,1);assert.equal(h.input()?.value,'未完成');h.type('已完成');await h.table().complete();h.render();assert.equal(f.requests[1].body.fields.status,'done');assert.equal(f.requests[1].body.fields.dueOn,'2026-11-09');assert.equal(f.requests[1].body.expectedRevision,4);assert.equal(h.table().records.length,0);assert.equal(h.input(),null);assert.equal(h.actions().state.data.tasks[0].status,'done');assert.equal(h.localWrites(),0);h.dispose();});

test('a filtered-out A draft requires explicit discard before starting B, including unchanged B and cleanup',async()=>{
 const f=fixture();f.addSecond();const h=await ready(f);h.table().startEditCell(0,1);h.type('A private draft');h.setTable(false);h.exclude(id);h.setTable(true);await flush();h.render();assert.equal(h.table().records[0]._id,secondId);assert.equal(h.input(),null);
 h.table().startEditCell(0,1);assert.equal(h.confirms(),1);assert.equal(h.input(),null);assert.equal(h.actions().taskCellDraftMemory.read().value,'A private draft');assert.equal(h.unload(),1);h.setTable(false);assert.equal(h.actions().taskCellDraftMemory.read().task.id,id);
 h.setTable(true);h.confirm(true);h.table().startEditCell(0,1);assert.equal(h.confirms(),2);assert.equal(h.input()?.value,'Original B');assert.equal(h.actions().taskCellDraftMemory.read(),null);assert.equal(h.unload(),0);
 h.type('B changed');h.setTable(false);assert.equal(h.actions().taskCellDraftMemory.read().task.id,secondId);assert.equal(h.actions().taskCellDraftMemory.read().value,'B changed');assert.equal(h.unload(),1);assert.equal(f.requests.length,0);h.dispose();
});
test('the same record on a different field also requires explicit discard',async()=>{
 const f=fixture(),h=await ready(f);h.table().startEditCell(0,1);h.type('Title draft');h.table().startEditCell(2,1);assert.equal(h.confirms(),1);assert.equal(h.input()?.value,'Title draft');assert.equal(h.actions().taskCellDraftMemory.read().field,'title');assert.equal(h.unload(),1);
 h.confirm(true);h.table().startEditCell(2,1);assert.equal(h.confirms(),2);assert.equal(h.input()?.value,'');assert.equal(h.actions().taskCellDraftMemory.read(),null);h.type('2026-11-10');assert.equal(h.actions().taskCellDraftMemory.read().field,'due');assert.equal(h.unload(),1);h.dispose();
});
test('scoped draft writers cannot clear another record/field or write back after a binding change',()=>{
 const memory=new draftModule.TaskCellDraftMemory(),binding={ownerId:'fixture-owner',spaceId:'fixture-space'},base={title:'Original',text:'Body',date:'',status:'open' as const};memory.verify(binding);
 const a={task:{id,revision:3},field:'title' as const,fields:base,value:'A draft'},b={task:{id:secondId,revision:3},field:'title' as const,fields:base,value:'B draft'};
 const oldWriter=memory.claim(a.task,a.field,()=>true)!;oldWriter(a);assert.equal(memory.claim(b.task,b.field,()=>false),null);oldWriter(null);oldWriter(a);
 const nextWriter=memory.claim(b.task,b.field,()=>true)!;nextWriter(b);oldWriter(null);oldWriter(a);assert.equal(memory.read()!.value,'B draft');nextWriter(null);assert.equal(memory.read(),null);nextWriter(b);
 const unrelated:any={id,kind:'todo',draft:{title:'A draft',notes:'Body',dueOn:null,status:'open'},source:{id:sourceId,system:'website',externalId:id,version:1,asOf:'2026-10-27T00:00:00Z',original:{marker:'personal-manual-v1',spaceId:'fixture-space',type:'todo',input:{}}},revision:4,syncState:'draft',externalStatus:null};memory.confirm(unrelated);assert.equal(memory.read()!.task.id,secondId);
 memory.verify({ownerId:'other-owner',spaceId:'fixture-space'});assert.equal(memory.read(),null);const fresh=memory.claim(a.task,a.field,()=>true)!;fresh({...a,value:'New owner draft'});nextWriter(null);nextWriter(b);assert.equal(memory.read()!.value,'New owner draft');
});

test('each ReUI editor receives the correct native control, accessible name and focus',async()=>{
 for(const col of[0,1,2]){const f=fixture(),h=await ready(f);h.table().startEditCell(col,1);const input=h.input()!;assert.ok(input);assert.equal(input.className,'input');assert.equal(input.attrs.get('aria-label'),['编辑待办','编辑状态','编辑到期日'][col]);assert.equal(input.tagName,col===1?'select':'input');assert.equal(input.type,col===2?'date':col===0?'text':'');assert.equal(h.activeElement(),input);assert.equal(input.disabled,false);h.dispose();}
});


test('ReUI saving/unknown parent transitions retain the same native input and Chinese draft',async()=>{
 const f=fixture(),h=await ready(f);h.table().startEditCell(0,1);h.type('中文未确认');const input=h.input();f.hold();f.mode('unknown');await h.table().complete();h.render();assert.equal(h.input(),input);assert.equal(h.input()?.value,'中文未确认');assert.equal(h.actions().taskCellDraftMemory.read()?.value,'中文未确认');f.release();await flush();h.render();assert.equal(h.actions().uncertain,true);assert.equal(h.input(),input);assert.equal(h.input()?.value,'中文未确认');assert.equal(h.actions().taskCellDraftMemory.read()?.value,'中文未确认');h.dispose();
});

test('ReUI first typed character is present in its native input, draft memory and authoritative saved command',async()=>{
 const f=fixture(),h=await ready(f);h.table().startEditCell(0,1,'待');assert.equal(h.input()?.value,'待');assert.equal(h.actions().taskCellDraftMemory.read()?.value,'待');h.type('待办中文');await h.table().complete();h.render();assert.equal(f.requests[0].body.fields.title,'待办中文');assert.equal(h.actions().state.data.tasks[0].title,'待办中文');h.dispose();
});


test('same-session virtual row unmount and remount restore retained native text and original revision',async()=>{
 const f=fixture(),h=await ready(f);h.table().startEditCell(0,1);h.type('虚拟行未提交');h.setRenderedRows(false);assert.equal(h.input(),null);assert.equal(h.actions().taskCellDraftMemory.read()?.value,'虚拟行未提交');h.setRenderedRows(true);assert.equal(h.input()?.value,'虚拟行未提交');assert.equal(h.actions().taskCellDraftMemory.read()?.task.revision,3);assert.equal(f.requests.length,0);h.input()!.fire('keydown',{key:'Escape'});h.render();assert.equal(h.input(),null);assert.equal(h.actions().taskCellDraftMemory.read(),null);h.dispose();
});

test('status and date initialText never fabricate native values or mutations; real selection still saves',async()=>{
 const f=fixture(),h=await ready(f);h.table().startEditCell(1,1,'任');assert.equal(h.input()?.value,'未完成');assert.equal(h.actions().taskCellDraftMemory.read(),null);assert.equal(f.requests.length,0);h.input()!.fire('keydown',{key:'Escape'});h.render();
 h.table().startEditCell(2,1);h.type('2026-11-09');await h.table().complete();h.table().startEditCell(2,1,'x');assert.equal(h.input()?.value,'2026-11-09');assert.equal(h.actions().taskCellDraftMemory.read(),null);assert.equal(f.requests.length,1);h.type('2026-11-10');await h.table().complete();assert.equal(f.requests[1].body.fields.dueOn,'2026-11-10');h.table().startEditCell(1,1);h.type('进行中');await h.table().complete();assert.equal(f.requests[2].body.fields.status,'in_progress');h.dispose();
});
