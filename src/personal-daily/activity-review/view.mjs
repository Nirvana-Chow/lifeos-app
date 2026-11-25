import { activityDate, calendarGrid, categories, dayLabel, initialDay as fixtureDay, localDay, maxActivityDay, minActivityDay, periodLabels, periodRange, projectActivity, recordSources, shiftDay, stages, stateLabels, summarizePeriod } from './activity.mjs';

/** @typedef {{ date: string, period: keyof typeof periodLabels, category: keyof typeof categories }} ActivitySelection */

/**
 * @param {Document | HTMLElement} root
 * @param {import('./journal-source.ts').JournalActivityInput | null} mapping
 * @param {{ fixtures?: typeof import('./fixtures.mjs').sources, isolated?: boolean, serverDay?: string,
 * mergeReceipts?: { label: string, href: string, at: string }[], selection?: ActivitySelection,
 * onSelectionChange?: (selection: ActivitySelection) => void }} [options]
 */
export function mountActivity(root, mapping, { fixtures, isolated = false, serverDay = fixtureDay, mergeReceipts = [], selection, onSelectionChange } = {}) {
  const mapped = mapping !== null;
  const asOf = mapped ? mapping.asOf ?? serverDay : fixtureDay;
  const journalEntries = mapping?.entries ?? [];
  function recordedSource(source) {
    const entries = journalEntries.filter(entry => entry.source === source);
    return { coverage: new Map(entries.map(entry => [entry.when.date, 'observed'])), entries,
      defaultState: mapping?.state === 'unauthorized' ? 'unauthorized' : 'unknown' };
  }
  const developmentEntries = mergeReceipts.map(({ label, href, at }) => ({
    id: href, title: label, when: { at }, stage: 'merged', verified: true, evidence: '查看合并记录', href,
  }));
  const sources = mapped ? {
    memos: recordedSource('memos'),
    diary: recordedSource('diary'),
    development: { coverage: new Map(developmentEntries.map(entry => [localDay(entry.when), 'observed'])), entries: developmentEntries },
  } : fixtures;
  let period = selection?.period ?? 'quarter';
  let calendar = null;
  const chartBody = root.querySelector('#chart-body');
  const calendarFooter = root.querySelector('#calendar-footer');
  const currentPeriod = root.querySelector('#period-current');
  const previousPeriod = root.querySelector('#previous-period');
  const nextPeriod = root.querySelector('#next-period');
  const periodButtons = [...root.querySelectorAll('button[data-period]')];
  const monthAxis = root.querySelector('#month-axis');
  const grid = root.querySelector('#grid');
  const graph = root.querySelector('#graph');
  const jump = root.querySelector('#jump');
  const summary = root.querySelector('#detail-summary');
  const detail = root.querySelector('#detail');
  const guideTitle = root.querySelector('#guide-title');
  const guideDescription = root.querySelector('#guide-description');
  const guideStages = root.querySelector('#guide-stages');
  const exampleActions = root.querySelector('#example-actions');
  const buttons = new Map();
  const sourceButtons = [...root.querySelectorAll('button[data-source]')];
  const projections = new Map();
  let category = selection?.category ?? (mapped ? 'records' : 'development');
  let selected = selection?.date ?? asOf;
  let focused = selected;
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

  jump.min = minActivityDay;
  jump.max = maxActivityDay;

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
    previousPeriod.disabled = range.first <= minActivityDay;
    nextPeriod.disabled = range.last >= maxActivityDay;
    for (const button of periodButtons) button.setAttribute('aria-pressed', String(button.dataset.period === period));
    root.querySelector('#activity-heading').textContent = singleDay ? '单日活动' : '活动热力图';
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
    if (!projections.has(key)) projections.set(key, projectActivity(sources, category, date, asOf));
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
    onSelectionChange?.({ date: selected, period, category });
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
    root.querySelector('#legend').dataset.category = category;
    root.querySelector('#partial-key').hidden = category === 'development' && !developmentEntries.length;
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
      : mapped && category === 'development' ? '当天没有可核对的交付证据，开发覆盖未知。'
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
            const evidenceLink = element(event.href ? 'a' : 'span', event.evidence, 'evidence');
            if (event.href) {
              evidenceLink.href = event.href;
              evidenceLink.rel = 'noreferrer';
              evidenceLink.setAttribute('aria-label', event.evidence + ' · ' + record.title);
            }
            row.append(badge, evidenceLink);
            evidence.append(row);
          }
        }
        entry.append(evidence);
      } else {
        entry.prepend(element('span', recordSources[record.source], 'badge source-badge'));
        if (!mapped) entry.append(element('p', record.text, 'record-body'));
        if (mapped) {
          const original = element('a', record.source === 'memos' ? '打开随手记原记录' : '打开日记原记录', 'original-record');
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
    root.querySelector('#period-title').textContent = overviewTitles[period];
    const metrics = root.querySelector('#period-metrics');
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
    root.querySelector('#period-coverage').textContent = coverageSummary.join(' · ');
    const periodStages = root.querySelector('#period-stages');
    periodStages.replaceChildren();
    periodStages.setAttribute('aria-label', periodLabels[period] + '阶段统计');
    if (category === 'development') {
      for (const stage of stages) {
        const count = stageCounts[stage.key];
        const item = element('li', stage.label + ' ' + (count || coverage.complete ? count : '—'), 'badge');
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
    guideDescription.textContent = isDevelopment ? (mapped
      ? '仅纳入需求进度已引用的合并证据，按实际合并时刻归日。开发全量来源尚未接入。'
      : '按当天有证据的成果去重计数，同项多阶段只计一次。')
      : mapped ? '按上海日历日展示已核对的随手记、思考和日记，保留原记录链接。'
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
      onSelectionChange?.({ date: selected, period, category });
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
    const date = activityDate(jump.value);
    if (!date) jump.value = selected;
    else if (!buttons.has(date)) setPeriod(period, date);
    else selectDay(date);
  });

  if (mapped) {
    const badge = root.querySelector('.sample');
    if (!isolated) {
      const back = element('a', '返回日记', 'back-to-journal');
      back.href = '/personal/journal';
      badge.replaceWith(back);
    } else {
      badge.textContent = '日记只读映射 · 隔离评审';
    }
    const status = root.querySelector('#mapping-state');
    status.hidden = false;
    status.textContent = mapping.state === 'ready'
      ? mapping.classificationPending ? '部分记录分类待核对，历史覆盖仍有未知。' : '按站内记录和已核对主题归类，历史覆盖仍有未知。'
      : mapping.state === 'unauthorized' ? '当前未获授权读取日记。' : '日记来源暂时无法核对。';
  }
  setPeriod(period, selected);
  renderGuide();
}
