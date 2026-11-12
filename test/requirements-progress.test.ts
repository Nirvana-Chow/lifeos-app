import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowCounts,workflowState,developmentQueueOrder,savedProgressEntries} from '../src/ui-review/requirements-progress.ts';
import {requirements} from '../src/platform/requirements.ts';
test('workflow counts do not infer active work from partial baseline implementation',()=>{
 const rows=requirements().requirements.slice(0,3),workflow=new Map([[rows[0].id,{state:'done' as const,purpose:'',nextStep:''}],[rows[1].id,{state:'planned' as const,purpose:'',nextStep:''}]]);
 assert.equal(workflowState(rows[2].id,workflow),'unrecorded');
 assert.deepEqual(workflowCounts(rows,workflow),{planned:1,in_progress:0,blocked:0,awaiting_review:0,done:1,unrecorded:1});
});
test('queue order uses the latest explicit saved queue marker and no invented dates',()=>{
 assert.equal(developmentQueueOrder('开发队列顺序：9\n正文\n开发队列顺序：2'),2);
 assert.equal(developmentQueueOrder('开发队列顺序：3；下一步：核验发布'),3);
 assert.equal(developmentQueueOrder('优先处理，预计明天'),null);
 assert.equal(developmentQueueOrder('开发队列顺序：0'),null);
});
test('saved progress only extracts strict dated sections, preserving text and latest first',()=>{
 const body='旧说明\n【开发跟进 2026-11-12T08:30:00+08:00】\n完成检查\n\n【其他说明】\n不应混入\n【开发跟进 昨天】\n不是日期\n【开发跟进 2026-11-13T09:00:00Z】\n继续下一项 <script>';
 assert.deepEqual(savedProgressEntries(body),[{at:'2026-11-13T09:00:00Z',text:'继续下一项 <script>'},{at:'2026-11-12T08:30:00+08:00',text:'完成检查'}]);
 assert.deepEqual(savedProgressEntries('没有进度记录'),[]);
});

test('saved progress rejects nonexistent dates and invalid wall times or explicit offsets',()=>{
 for(const at of ['2026-02-30T09:00:00+08:00','2026-02-29T09:00:00Z','1900-02-29T09:00:00Z','2026-04-31T09:00:00Z','0000-01-01T09:00:00Z','2026-13-01T09:00:00Z','2026-01-00T09:00:00Z','2026-11-13T24:00:00Z','2026-11-13T09:60:00Z','2026-11-13T09:00:60Z','2026-11-13T09:00:00+14:01','2026-11-13T09:00:00+15:00','2026-11-13T09:00:00+08:60','2026-11-13T09:00:00-00:00','2026-11-13T09:00:00','2026-11-13T09:00:00+0800']){
  assert.deepEqual(savedProgressEntries(`【开发跟进 ${at}】\n无效时间不应显示`),[],at);
 }
});
test('saved progress preserves valid leap dates and explicit ISO timestamps verbatim',()=>{
 for(const at of ['2024-02-29T09:00:00+08:00','2000-02-29T23:59:59.999Z','2026-11-13T09:00:00+08:00','2026-11-13T09:00:00Z','2026-11-13T09:00:00+00:00','2026-11-13T09:00:00+14:00','2026-11-13T09:00:00-14:00']){
  assert.deepEqual(savedProgressEntries(`【开发跟进 ${at}】\n原始记录`),[{at,text:'原始记录'}],at);
 }
});
