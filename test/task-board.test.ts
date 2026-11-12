import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

type Node={type:unknown;props:Record<string,any>};
const find=(node:any,type:string):Node|undefined=>!node||typeof node!=='object'?undefined:Array.isArray(node)?node.map(child=>find(child,type)).find(Boolean):node.type===type?node:find(node.props?.children,type);
const textContent=(node:any):string=>node==null?'':typeof node==='string'?node:Array.isArray(node)?node.map(textContent).join(''):typeof node==='object'?textContent(node.props?.children):String(node);
function fixture(){
 let cursor=0;const values:any[]=[],writes:unknown[]=[];
 const react={useState(initial:any){const index=cursor++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return[values[index],(value:any)=>values[index]=typeof value==='function'?value(values[index]):value];},useRef(initial:any){const index=cursor++;return values[index]??(values[index]={current:initial});},useMemo(fn:Function){return fn();},useEffect(){}};
 const jsx={jsx:(type:unknown,props:Record<string,unknown>)=>({type,props}),jsxs:(type:unknown,props:Record<string,unknown>)=>({type,props})};
 const module={exports:{} as any};const imports:Record<string,unknown>={react,'react/jsx-runtime':jsx,'lucide-react':{GripVertical:'grip'},'../personal-candidate/task-editor-state':{taskStatusLabels:{open:'未完成',in_progress:'进行中',done:'已完成',cancelled:'已取消'}},'./ui/button':{Button:'button'},'./task-board.module.css':{default:{}},'./reui/kanban':Object.fromEntries(['Kanban','KanbanBoard','KanbanColumn','KanbanColumnHandle','KanbanColumnContent','KanbanItem','KanbanItemHandle'].map(name=>[name,name]))};
 const code=ts.transpileModule(readFileSync('src/ui-review/task-board.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',code)((name:string)=>{assert.ok(name in imports,name);return imports[name];},module,module.exports);
 let props:any={tasks:[{id:'synthetic-task',revision:2,title:'合成任务',status:'open',dueOn:null}],writable:true,blocked:false,onSetTaskStatus:(...args:unknown[])=>writes.push(args),renderCard:()=>null};
 const render=()=>{cursor=0;return find(module.exports.TaskBoard(props),'Kanban')!.props;};
 const start=()=>{const native=render();native.onDragStart({active:{id:'synthetic-task'}});native.onValueChange({open:[],in_progress:[],done:props.tasks,cancelled:[]});return render();};
 const meta=(extra:Record<string,unknown>={})=>({kind:'item',activeContainer:'open',overContainer:'done',activeIndex:0,overIndex:0,event:{active:{id:'synthetic-task'},over:{id:'done'}},previousValue:{open:props.tasks},...extra});
 return{render,start,meta,writes,update:(patch:Record<string,unknown>)=>{props={...props,...patch};return render();}};
}

test('native commit calls the existing writer once and restores authoritative status until late receipt',()=>{
 const f=fixture(),native=f.start();assert.equal(native.value.done.length,1);
 native.onValueCommit(native.value,f.meta());assert.deepEqual(f.writes,[[{id:'synthetic-task',revision:2},'done']]);
 assert.equal(f.render().value.open.length,1);assert.equal(f.render().value.done.length,0);
 native.onValueCommit(native.value,f.meta());assert.equal(f.writes.length,1,'duplicate native callbacks are not new service commands');
 const readback=f.update({tasks:[{id:'synthetic-task',revision:3,title:'合成任务',status:'done',dueOn:null}]});assert.equal(readback.value.done.length,1);
});
test('rejected drop keeps authoritative status and saving, uncertain host blocking, stale revision and missing drop target never write',()=>{
 for(const mode of ['blocked','readonly','stale','missing-over'] as const){const f=fixture(),native=f.start();if(mode==='blocked')f.update({blocked:true});if(mode==='readonly')f.update({writable:false});if(mode==='stale')f.update({tasks:[{id:'synthetic-task',revision:3,title:'更新后的合成任务',status:'open'}]});native.onValueCommit(native.value,f.meta(mode==='missing-over'?{event:{active:{id:'synthetic-task'},over:null}}:{}));assert.deepEqual(f.writes,[],mode);assert.equal(f.render().value.open.length,1,mode);}
});
test('Escape and browser-only card arrangement never create a status command',()=>{
 const f=fixture();let native=f.start();native.onDragCancel();assert.equal(f.render().value.open.length,1);assert.equal(f.writes.length,0);
 native=f.start();native.onValueCommit(native.value,f.meta({overContainer:'open'}));assert.equal(f.writes.length,0);assert.equal(f.render().value.open.length,1);
});
test('scope change hides the previous drag preview on the first render before cleanup and cannot write',()=>{
 const f=fixture();f.update({scope:'synthetic-owner:one'});const previous=f.start();
 const replacement=[{id:'new-scope-task',revision:1,title:'另一作用域的合成任务',status:'open',dueOn:null}];
 const changed=f.update({scope:'synthetic-owner:two',tasks:replacement});
 assert.deepEqual(Object.values(changed.value).flat().map((task:any)=>task.id),['new-scope-task']);
 assert.equal(JSON.stringify(changed.children).includes('synthetic-task'),false,'rendered cards must share the scope-bound native value');
 previous.onValueChange(previous.value);
 assert.deepEqual(Object.values(f.render().value).flat().map((task:any)=>task.id),['new-scope-task'],'late old-scope preview callbacks stay hidden');
 previous.onValueCommit(previous.value,f.meta());assert.deepEqual(f.writes,[]);
});

test('board cards label existing project and area references without writing classification',()=>{
 const f=fixture();
 const native=f.update({tasks:[{id:'synthetic-task',revision:2,title:'合成任务',status:'open',project:{id:'p',title:'合成项目'},area:{id:'a',title:'合成领域'}}]});
 const classification=find(native.children,'dl');
 assert.ok(classification,'cards expose their classification as a description list');
 assert.equal(classification.props['aria-label'],'待办分类');
 assert.match(textContent(classification),/项目合成项目领域合成领域/);
 assert.deepEqual(f.writes,[]);
});

test('missing board references stay explicitly unassociated rather than implying inbox classification',()=>{
 const f=fixture(),classification=find(f.render().children,'dl');
 assert.ok(classification);
 assert.match(textContent(classification),/项目未关联项目领域未关联领域/);
 assert.equal(textContent(classification).includes('收件箱'),false);
 assert.deepEqual(f.writes,[]);
});
