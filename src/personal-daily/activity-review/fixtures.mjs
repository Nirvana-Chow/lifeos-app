import { initialDay, stages, yearGrid } from './activity.mjs';

const dates = yearGrid(2026).rows.flat().filter(Boolean).sort();
const sampleCoverage = { memos: new Map(), diary: new Map(), development: new Map() };

const memo = ['记一条阅读线索', '整理本周的纸质资料', '试着画一张路线草图', '随手记下下一次要核对的问题'];
const diary = ['把读书时间放在晚饭前。翻完一章后，记下想回看的段落。'];
const development = ['测试样例补齐', '页面排版检查', '文档核对', '日期规则复核'];
const samples = { memos: [], diary: [], development: [] };

for (const [index, date] of dates.entries()) {
  if (date > initialDay) break;
  for (const [category, coverage] of Object.entries(sampleCoverage)) {
    const salt = { memos: 17, diary: 11, development: 23 }[category];
    const seed = Math.abs(Math.sin((index + 3) * salt) * 10000) % 1;
    const state = date === '2026-11-23' ? 'unauthorized'
      : date === '2026-11-22' || seed < 0.025 ? 'unknown' : 'complete';
    coverage.set(date, date === initialDay ? 'complete' : state);
    if (state !== 'complete' || date >= '2026-11-21') continue;

    const count = category === 'diary' ? Number(seed > 0.54)
      : category === 'development' ? (seed > 0.94 ? 4 : seed > 0.70 ? 1 + index % 3 : 0)
      : seed > 0.38 ? 1 + index % 4 : 0;
    for (let i = 0; i < count; i += 1) {
      const when = { date };
      const id = category + '-' + date + '-' + i;
      if (category === 'memos') samples.memos.push({ id, when, text: memo[i] });
      if (category === 'diary') samples.diary.push({ id, when, title: '示例日记', text: diary[0] });
      if (category === 'development') samples.development.push({
        id, when, title: development[i], verified: true,
        stage: stages[(index + i) % stages.length].key, evidence: '合成证据 ' + (index + 1) + '.' + (i + 1),
      });
    }
  }
}

samples.memos.push(
  { id: 'm-1', when: { at: '2026-11-23T16:00:00Z' }, text: '下次到河边带一本小速写本。' },
  { id: 'm-2', when: { date: initialDay }, title: '周末想法', text: '把周末的阅读书单缩到三本。' },
);
samples.diary.push({ id: 'j-1', when: { date: initialDay }, title: '沿河慢走',
  text: '今天沿河走了一段，听见风吹芦苇。\n\n回家以后把窗边的书读完了。' });
samples.development.push(
  { id: 'd-1', when: { date: initialDay }, title: '日常活动视图', stage: 'candidate', verified: true, evidence: '样例补丁与 6 项聚焦检查' },
  { id: 'd-2', when: { date: initialDay }, title: '日期筛选修正', stage: 'merged', verified: true, evidence: '样例 PR #014 · 目标树已核对' },
  { id: 'd-2', when: { date: initialDay }, title: '日期筛选修正', stage: 'released', verified: true, evidence: '样例发布 v0.8 · 运行版本回读一致' },
  { id: 'd-3', when: { date: initialDay }, title: '日期键盘切换', stage: 'accepted', verified: true, evidence: '样例验收 · 键盘路径通过' },
  { id: 'd-4', when: { date: initialDay }, title: '待确认的构建', stage: 'candidate', verified: false, evidence: '合成未核证条目' },
);

sampleCoverage.diary.set('2026-11-20', 'unauthorized');

export const sources = Object.fromEntries(
  Object.entries(samples).map(([key, entries]) => [key, { entries, coverage: sampleCoverage[key] }]),
);
