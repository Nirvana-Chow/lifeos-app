import assert from 'node:assert/strict';
import test from 'node:test';
import {journalRoutineTemplate, readJournalRoutine} from '../src/personal-journal/routine.ts';
const prefix=journalRoutineTemplate.split('\n')[0];

test('routine reads only the authored section and lets a plan remain a plan',()=>{
 assert.deepEqual(readJournalRoutine(journalRoutineTemplate),{plan:'',happened:'',summary:''});
 assert.deepEqual(readJournalRoutine(prefix+'\n## 计划\n预定走路\n## 发生\n\n## 总结\n留待明天'),{
  plan:'预定走路',happened:'',summary:'留待明天',
 });
 assert.deepEqual(readJournalRoutine(prefix+'\r\n## 计划\r\n构思\r\n## 发生\r\n读书\r\n跑步\r\n## 总结\r\n按原文保存'),{
  plan:'构思',happened:'读书\n跑步',summary:'按原文保存',
 });
});

test('legacy, partial and ambiguous headings retain the whole-body view',()=>{
 for(const body of ['昨天计划了明天的事','旧记录\n'+journalRoutineTemplate,'## 计划\n草稿','## 总结\n## 发生\n## 计划',
  '## 计划\n计划内容\n## 发生\n日常正文\n## 总结',
  prefix+'\n## 计划\n内容\n## 发生\n## 发生\n## 总结'])assert.equal(readJournalRoutine(body),null);
});
