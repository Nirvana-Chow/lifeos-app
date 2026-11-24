import { calendarGrid, categories, dayLabel, initialDay as fixtureDay, periodLabels, periodRange, projectActivity, recordSources, shiftDay, stages, stateLabels, summarizePeriod } from './activity.mjs';

const payload = document.querySelector('#journal-activity-input');
const published = document.documentElement.dataset.activityMode === 'journal';
const mapped = published || payload !== null;
let mapping = { state: 'unknown' };
if (mapped) {
  try {
    const parsed = JSON.parse(payload.textContent);
    if (parsed?.state === 'unauthorized' ||
        parsed?.state === 'ready' && Array.isArray(parsed.entries) && /^\d{4}-\d{2}-\d{2}$/.test(parsed.asOf)) {
      mapping = parsed;
    }
  } catch {
    // An unreadable mapping must never activate the synthetic fixture.
  }
}
const initialDay = mapped ? mapping.asOf : fixtureDay;
const sources = mapped ? {
  memos: { coverage: new Map(), entries: [] },
  diary: { coverage: new Map((mapping.entries ?? []).map(entry => [entry.when.date, 'observed'])), entries: mapping.entries ?? [] },
  development: { coverage: new Map(), entries: [] },
} : (await import('./fixtures.mjs')).sources;
let period = 'quarter';
let calendar = null;
const chartBody = document.querySelector('#chart-body');
const calendarFooter = document.querySelector('#calendar-footer');
const currentPeriod = document.querySelector('#period-current');
const previousPeriod = document.querySelector('#previous-period');
const nextPeriod = document.querySelector('#next-period');
const periodButtons = [...document.querySelectorAll('button[data-period]')];
const monthAxis = document.querySelector('#month-axis');
const grid = document.querySelector('#grid');
const graph = document.querySelector('#graph');
const jump = document.querySelector('#jump');
const summary = document.querySelector('#detail-summary');
const detail = document.querySelector('#detail');
const guideTitle = document.querySelector('#guide-title');
const guideDescription = document.querySelector('#guide-description');
const guideStages = document.querySelector('#guide-stages');
const exampleActions = document.querySelector('#example-actions');
const buttons = new Map();
const sourceButtons = [...document.querySelectorAll('button[data-source]')];
const projections = new Map();
let category = mapped ? 'records' : 'development';
let selected = initialDay;
let focused = initialDay;
const minDay = '0002-01-01';
const maxDay = '9998-12-31';
const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日'];
const overviewTitles = { week: '本周总览', month: '月度总览', quarter: '季度总览', year: '全年总览' };

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function rebuildGrid() {
  buttons.clear();
  monthAxis.replaceChildren();
  grid.replaceChildren();
  const weekly = period === 'week';
  const rows = weekly ? [calendar.rows.map(row => row[0])] : calendar.rows;
  graph.style.setProperty('--columns', weekly ? 7 : calendar.columns);
  grid.setAttribute('aria-label', currentPeriod.textContent + ' 每日活动');
  if (weekly || period === 'month') {
    const ticks = weekly ? rows[0] : calendar.rows[0].map((_, column) => calendar.rows.find(row => row[column])[column]);
    ticks.forEach((day, index) => {
      const label = weekly ? '周' + weekdayLabels[index] : day.slice(5);
      monthAxis.append(element('span', label));
    });
  } else {
    for (const { column, label } of calendar.months) {
      const tick = element('span', label);
      tick.style.gridColumn = column;
      monthAxis.append(tick);
    }
  }
  for (const dates of rows) {
    const row = element('div', undefined, 'days-row');
    row.setAttribute('role', 'row');
    for (const date of dates) {
      const cell = element('div', undefined, 'slot');
      cell.setAttribute('role', 'gridcell');
      if (date !== null) {
        const button = element('button', undefined, 'tile');
        button.type = 'button';
        button.dataset.date = date;
        if (weekly) button.append(element('span', date.slice(8), 'tile-day'));
        buttons.set(date, { button, cell });
        cell.append(button);
      } else {
        cell.setAttribute('aria-hidden', 'true');
      }
      row.append(cell);
    }
    grid.append(row);
  }
}

jump.min = minDay;
jump.max = maxDay;

function rangeCaption({ first, last }) {
  if (first === last) return first;
  if (first.slice(0, 4) !== last.slice(0, 4)) return first + ' 至 ' + last;
  return first + ' 至 ' + last.slice(5);
}

function setPeriod(value, date = selected) {
  period = value;
  selected = date;
  focused = date;
  const range = periodRange(date, period);
  const singleDay = period === 'day';
  calendar = singleDay ? null : calendarGrid(range);
  currentPeriod.textContent = rangeCaption(range);
  previousPeriod.setAttribute('aria-label', '上一' + periodLabels[period]);
  nextPeriod.setAttribute('aria-label', '下一' + periodLabels[period]);
  previousPeriod.disabled = range.first <= minDay;
  nextPeriod.disabled = range.last >= maxDay;
  for (const button of periodButtons) button.setAttribute('aria-pressed', String(button.dataset.period === period));
  document.querySelector('#activity-heading').textContent = singleDay ? '单日活动' : '活动热力图';
  chartBody.hidden = singleDay;
  calendarFooter.hidden = singleDay;
  chartBody.dataset.period = period;
  if (singleDay) {
    buttons.clear();
    grid.replaceChildren();
    monthAxis.replaceChildren();
  } else rebuildGrid();
  renderGrid();
  selectDay(date);
  renderOverview();
}

function projection(date) {
  const key = category + ':' + date;
  if (!projections.has(key)) projections.set(key, projectActivity(sources, category, date, initialDay));
  return projections.get(key);
}

function selectDay(date) {
  if (period !== 'day') {
    if (!buttons.has(date)) return;
    buttons.get(selected).cell.setAttribute('aria-selected', 'false');
    buttons.get(date).cell.setAttribute('aria-selected', 'true');
    focusDay(date, false);
  }
  selected = date;
  jump.value = selected;
  renderDetail();
}

function focusDay(date, moveFocus) {
  buttons.get(focused).button.tabIndex = -1;
  focused = date;
  const target = buttons.get(date).button;
  target.tabIndex = 0;
  if (moveFocus) target.focus();
}

function renderGrid() {
  graph.dataset.category = category;
  document.querySelector('#legend').dataset.category = category;
  document.querySelector('#partial-key').hidden = category !== 'records';
  for (const [date, { button, cell }] of buttons) {
    const day = projection(date);
    const label = date + ' · ' + dayLabel(day, category);
    button.dataset.level = day.level;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.tabIndex = date === focused ? 0 : -1;
    cell.setAttribute('aria-selected', String(date === selected));
  }
  for (const button of sourceButtons) button.setAttribute('aria-pressed', String(button.dataset.source === category));
}

function renderDetail() {
  const day = projection(selected);
  summary.textContent = selected + ' · ' + categories[category].label + ' · ' + dayLabel(day, category);
  const source = mapped ? '此日期的来源' : '此日期的样例来源';
  const text = day.state === 'future' ? '此日期尚未到达。'
    : day.state === 'unauthorized' ? source + '未获授权。'
    : day.state === 'unknown' ? source + '覆盖未知。'
    : '此日期已核对，暂无该来源的记录。';
  detail.replaceChildren();
  if (day.sourceStates) {
    const labels = Object.entries(day.sourceStates)
      .filter(([, state]) => state !== 'complete')
      .map(([source, state]) => recordSources[source] + ' ' + stateLabels[state]);
    detail.append(element('p', labels.join(' · '), 'empty'));
  }
  if (day.entries.length === 0) {
    if (!day.sourceStates) detail.append(element('p', text, 'empty'));
    return;
  }
  for (const record of day.entries) {
    const entry = element('article', undefined, 'entry');
    if (record.title) entry.append(element('h3', record.title));
    if (category === 'development') {
      const evidence = element('ul', undefined, 'milestones');
      for (const stage of stages) {
        for (const event of record.milestones.filter(item => item.stage === stage.key)) {
          const row = element('li');
          const badge = element('span', stage.label, 'badge');
          badge.dataset.stage = stage.key;
          row.append(badge, element('span', event.evidence, 'evidence'));
          evidence.append(row);
        }
      }
      entry.append(evidence);
    } else {
      entry.prepend(element('span', recordSources[record.source], 'badge source-badge'));
      if (!mapped) entry.append(element('p', record.text, 'record-body'));
      if (mapped && record.source === 'diary') {
        const original = element('a', '打开日记原记录', 'original-record');
        original.href = record.href;
        entry.append(original);
      }
    }
    detail.append(entry);
  }
}

function renderOverview() {
  if (!calendar) return;
  const { count, activeDays, coverage, stageCounts } = summarizePeriod([...buttons.keys()].map(projection), category);
  document.querySelector('#period-title').textContent = overviewTitles[period];
  const metrics = document.querySelector('#period-metrics');
  metrics.replaceChildren();
  for (const [label, value] of [
    [category === 'development' ? '已核成果' : '已核记录', count || coverage.complete ? count : '—'],
    ['已核活动日', activeDays || coverage.complete ? activeDays : '—'],
    ['完整覆盖日', coverage.complete],
  ]) {
    const metric = element('div');
    metric.append(element('dt', label), element('dd', String(value)));
    metrics.append(metric);
  }
  const coverageSummary = Object.entries(stateLabels).filter(([key]) => coverage[key])
    .map(([key, label]) => label + ' ' + coverage[key] + ' 天');
  document.querySelector('#period-coverage').textContent = coverageSummary.join(' · ');
  const periodStages = document.querySelector('#period-stages');
  periodStages.replaceChildren();
  periodStages.setAttribute('aria-label', periodLabels[period] + '阶段统计');
  if (category === 'development') {
    for (const stage of stages) {
      const item = element('li', stage.label + ' ' + (coverage.complete ? stageCounts[stage.key] : '—'), 'badge');
      item.dataset.stage = stage.key;
      periodStages.append(item);
    }
  }
}

const stageNotes = [
  '补丁、树或聚焦检查已经核对。',
  '目标分支的合并结果已经核对。',
  '实际运行版本与发布证据相符。',
  '有独立的验收结果。',
];

function renderGuide() {
  const isDevelopment = category === 'development';
  guideTitle.textContent = isDevelopment ? '开发证据说明' : '记录统计口径';
  guideDescription.textContent = isDevelopment ? '按当天有证据的成果去重计数，同项多阶段只计一次。'
    : mapped ? '按上海日历日展示已核对的日记。原文在已有日记入口查看。'
    : '随手记与日记按上海日历日一起查看。详情保留各自来源、标题与原文。';
  guideStages.replaceChildren();
  if (isDevelopment) {
    for (const [index, stage] of stages.entries()) {
      const line = element('div');
      line.append(element('dt', stage.label), element('dd', stageNotes[index]));
      guideStages.append(line);
    }
  }
  exampleActions.hidden = mapped || !isDevelopment;
}

for (const button of sourceButtons) {
  button.addEventListener('click', () => {
    category = button.dataset.source;
    renderGrid();
    renderDetail();
    renderGuide();
    renderOverview();
  });
}

grid.addEventListener('click', event => {
  const date = event.target.closest('button[data-date]')?.dataset.date;
  if (date) selectDay(date);
});
grid.addEventListener('keydown', event => {
  const date = event.target.closest('button[data-date]')?.dataset.date;
  if (!date || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const offsets = period === 'week' ? { ArrowLeft: -1, ArrowRight: 1 }
    : { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
  const offset = offsets[event.key];
  if (offset === undefined) return;
  event.preventDefault();
  const next = shiftDay(date, offset);
  if (buttons.has(next)) focusDay(next, true);
});
for (const button of periodButtons) {
  button.addEventListener('click', () => setPeriod(button.dataset.period));
}
previousPeriod.addEventListener('click', () => setPeriod(period, shiftDay(periodRange(selected, period).first, -1)));
nextPeriod.addEventListener('click', () => setPeriod(period, shiftDay(periodRange(selected, period).last, 1)));
jump.addEventListener('change', () => {
  const date = jump.value;
  if (!date || !jump.validity.valid) jump.value = selected;
  else if (!buttons.has(date)) setPeriod(period, date);
  else selectDay(date);
});

if (mapped) {
  const badge = document.querySelector('.sample');
  if (published) {
    const back = element('a', '返回日记', 'back-to-journal');
    back.href = '/personal/journal';
    badge.replaceWith(back);
  } else {
    badge.textContent = '日记只读映射 · 隔离评审';
  }
  const status = document.querySelector('#mapping-state');
  status.hidden = false;
  status.textContent = mapping.state === 'ready'
    ? '日记来自已核对的日记快照。Memos 和开发证据尚无可核对的来源。'
    : mapping.state === 'unauthorized' ? '当前未获授权读取日记。' : '日记来源暂时无法核对。';
  if (mapping.state !== 'ready') document.querySelector('main').hidden = true;
}
if (!mapped || mapping.state === 'ready') {
  setPeriod(period, initialDay);
  renderGuide();
}
