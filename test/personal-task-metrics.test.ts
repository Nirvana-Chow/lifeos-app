import test from 'node:test';
import assert from 'node:assert/strict';
import {filterTasks,taskMetrics,metricTaskFilter} from '../src/ui-review/selectors.ts';
import type {TaskRow,WorkspaceState} from '../src/ui-review/contract.ts';
const base:TaskRow={id:'one',revision:1,title:'Synthetic',notes:null,status:'open',dueOn:null,area:null,project:null,inInbox:null,sourceLabel:null};
const today='2030-11-02';
const tasks:TaskRow[]=[base,{...base,id:'today',dueOn:today},{...base,id:'progress',status:'in_progress',dueOn:today},{...base,id:'old',dueOn:'2030-11-01'},{...base,id:'done',status:'done',dueOn:today},{...base,id:'cancelled',status:'cancelled',dueOn:'2030-11-01'},{...base,id:'future',dueOn:'2030-11-03'}];
test('metric destinations exactly select pending today and overdue counts',()=>{
 const state:WorkspaceState={status:'ready',data:{tasks,areas:[],projects:[],today,asOf:'2030-11-02T00:00:00Z',coverage:'complete'}};
 const metrics=taskMetrics(state);assert.deepEqual(metrics,{total:7,pending:5,dueToday:2,overdue:1,done:1,inbox:null});
 for(const [metric,count] of [['pending',metrics.pending],['today',metrics.dueToday],['overdue',metrics.overdue]] as const)assert.equal(filterTasks(tasks,metricTaskFilter(metric),today).length,count);
 assert.deepEqual(filterTasks(tasks,metricTaskFilter('today'),today).map(x=>x.id),['today','progress']);
 assert.deepEqual(filterTasks(tasks,metricTaskFilter('overdue'),today).map(x=>x.id),['old']);
 assert.deepEqual(filterTasks(tasks,metricTaskFilter('overdue')).map(x=>x.id),[],'date scope unavailable must not broaden to all records');
});
