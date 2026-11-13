import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as tanstack from '@tanstack/react-table';
import ts from 'typescript';

const native=createRequire(import.meta.url),cache=new Map<string,any>();
function load(file:string):any{
 if(cache.has(file))return cache.get(file);
 const module={exports:{} as any};cache.set(file,module.exports);
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)((key:string)=>{
  if(key.endsWith('.css'))return {__esModule:true,default:{}};
  if(!key.startsWith('.'))return native(key);
  const base=resolve(dirname(file),key),path=[base,base+'.tsx',base+'.ts'].find(existsSync);assert.ok(path,key);return load(path);
 },module,module.exports);return module.exports;
}
const grid=load(resolve('src/ui-review/reui/data-grid.tsx')),renderer=load(resolve('src/ui-review/reui/data-grid-table.tsx'));
const features=tanstack.tableFeatures({...grid.dataGridFeatures,columnGroupingFeature:tanstack.columnGroupingFeature,groupedRowModel:tanstack.createGroupedRowModel()});
const data=[{id:'z',title:'Zulu',project:'one'},{id:'a',title:'Alpha',project:'one'},{id:'m',title:'Mike',project:'two'},{id:'q',title:'Quebec',project:'two'}];
function render(state:Record<string,unknown>={},options:Record<string,unknown>={}){
 let table:any;
 function Fixture(){
  table=tanstack.useTable({features,data,columns:[{id:'title',accessorFn:(row:typeof data[number])=>row.title,header:'Title',cell:({row,getValue}:any)=>row.getIsGrouped()?'Group '+row.groupingValue:String(getValue())},{id:'project',accessorFn:(row:typeof data[number])=>row.project,header:'Project',cell:({row,getValue}:any)=>row.getIsGrouped()?null:String(getValue())}],getRowId:(row:typeof data[number])=>row.id,state:{pagination:{pageIndex:0,pageSize:10},...state},groupedColumnMode:false,enableRowSelection:false,...options} as any);
  return React.createElement(grid.DataGridContainer,null,React.createElement(grid.DataGrid,{table,recordCount:data.length,tableLayout:{cellSelection:true,cellSelectionMode:'single',rowsPinnable:true}},React.createElement(renderer.DataGridTable)));
 }
 const html=renderToStaticMarkup(React.createElement(Fixture)),rows=[...html.matchAll(/<tr\b[^>]*data-row-id="([^"]+)"[^>]*>/g)].map(match=>({id:match[1],aria:match[0].match(/aria-rowindex="(\d+)"/)?.[1]}));
 return {table,rows,html};
}
function expected(table:any){return new Map(table.getRowsInDisplayOrder().map((row:any,index:number)=>[row.id,String(index+2)]));}
function assertOrder(value:ReturnType<typeof render>){
 const indices=expected(value.table);assert.ok(value.rows.length>0);
 for(const row of value.rows)assert.equal(row.aria,indices.get(row.id),row.id);
 const present=value.rows.flatMap(row=>row.aria?[row.aria]:[]);assert.equal(new Set(present).size,present.length);
}
test('group and leaf rows announce their distinct native display positions',()=>{
 const value=render({grouping:['project'],expanded:true});assert.equal(value.rows.length,6);assertOrder(value);
});
test('sorted and filtered rows use the same order as native keyboard navigation',()=>{
 const value=render({sorting:[{id:'title',desc:false}],columnFilters:[{id:'title',value:'a'}]});assertOrder(value);
});
test('pagination announces absolute pre-pagination positions rather than page-relative indexes',()=>{
 const value=render({sorting:[{id:'title',desc:false}],pagination:{pageIndex:1,pageSize:2}});assert.deepEqual(value.rows.map(row=>row.id),['q','z']);assertOrder(value);
});
test('top and bottom pinned rows retain native absolute positions without duplicate row numbers',()=>{
 const value=render({sorting:[{id:'title',desc:false}],pagination:{pageIndex:0,pageSize:2},rowPinning:{top:['z'],bottom:['a']}},{keepPinnedRows:true});assert.equal(value.rows[0].id,'z');assert.equal(value.rows.at(-1)?.id,'a');assertOrder(value);
});
test('a retained pinned row outside the filtered keyboard order receives no invented display index',()=>{
 const value=render({columnFilters:[{id:'title',value:'Alpha'}],rowPinning:{top:['z'],bottom:[]}},{keepPinnedRows:true});assert.ok(value.rows.some(row=>row.id==='z'));assertOrder(value);
});
test('default ungrouped row indices remain unchanged',()=>{
 const value=render();assert.deepEqual(value.rows.map(row=>row.aria),['2','3','4','5']);assertOrder(value);
});
