// The review consumes source summaries supplied by its caller. It has no data connector.
export const timeZone = 'Asia/Shanghai';
export const initialDay = '2026-11-24';

const isoDay = /^\d{4}-\d{2}-\d{2}$/;
const explicitInstant = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });

function civilDate(date) {
  const value = new Date(date + 'T00:00:00Z');
  if (!isoDay.test(date) || !Number.isFinite(+value) || value.toISOString().slice(0, 10) !== date) {
    throw new RangeError('需要有效的日历日期');
  }
  return value;
}

export function localDay({ date, at }) {
  if (date !== undefined && at === undefined) {
    civilDate(date);
    return date;
  }
  if (date !== undefined || typeof at !== 'string' || !explicitInstant.test(at)) {
    throw new RangeError('需要一个日期或带时区的时刻');
  }
  civilDate(at.slice(0, 10));
  return dayFormat.format(new Date(at));
}

export function shiftDay(date, offset) {
  const value = civilDate(date);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

export const periodLabels = { day: '日', week: '周', month: '月', quarter: '季度', year: '年' };

function mondayOffset(date) {
  return (civilDate(date).getUTCDay() + 6) % 7;
}

export function periodRange(date, period) {
  civilDate(date);
  if (period === 'day') return { first: date, last: date };
  if (period === 'week') {
    const first = shiftDay(date, -mondayOffset(date));
    return { first, last: shiftDay(first, 6) };
  }
  const months = { month: 1, quarter: 3, year: 12 }[period];
  if (!months) throw new RangeError('期间无效');
  const month = Math.floor((Number(date.slice(5, 7)) - 1) / months) * months + 1;
  const first = date.slice(0, 4) + '-' + String(month).padStart(2, '0') + '-01';
  const end = civilDate(first);
  end.setUTCMonth(end.getUTCMonth() + months, 0);
  return { first, last: end.toISOString().slice(0, 10) };
}

export function yearGrid(year, quarter = 0) {
  if (!Number.isInteger(quarter) || quarter < 0 || quarter > 4) throw new RangeError('季度无效');
  const month = String(quarter ? quarter * 3 - 2 : 1).padStart(2, '0');
  return calendarGrid(periodRange(year + '-' + month + '-01', quarter ? 'quarter' : 'year'));
}

export function calendarGrid({ first, last }) {
  const offset = mondayOffset(first);
  const start = shiftDay(first, -offset);
  const rows = Array.from({ length: 7 }, () => []);
  const months = [];
  let columns = 0;
  for (let day = start; day <= last; day = shiftDay(day, 7)) {
    for (let row = 0; row < 7; row += 1) {
      const date = shiftDay(day, row);
      rows[row].push(date >= first && date <= last ? date : null);
      if (date >= first && date <= last && date.endsWith('-01')) {
        months.push({ column: columns + 1, label: Number(date.slice(5, 7)) + '月' });
      }
    }
    columns += 1;
  }
  return { first, last, rows, months, columns };
}

export const stages = [
  { key: 'candidate', label: '代码候选' },
  { key: 'merged', label: '已合并' },
  { key: 'released', label: '实际发布' },
  { key: 'accepted', label: '验收' },
];

export const categories = {
  records: { label: '记录', unit: '条记录' },
  development: { label: '开发', unit: '项可核成果' },
};

export const recordSources = { memos: 'Memos', diary: '日记' };

export const stateLabels = {
  unknown: '覆盖未知',
  unauthorized: '未获授权',
  partial: '部分覆盖',
  future: '未到日期',
};

const isVerifiedMilestone = item => item.verified === true && !!item.evidence?.trim() &&
  stages.some(stage => stage.key === item.stage);

export function projectDay(source, category, date) {
  const state = source.coverage.get(date) ?? 'unknown';
  const observedDiary = category === 'diary' && state === 'observed';
  if (state !== 'complete' && !observedDiary) return { state, count: null, level: state, entries: [] };

  if (category === 'development') {
    const entries = new Map();
    for (const event of source.entries) {
      if (!isVerifiedMilestone(event) || localDay(event.when) !== date) continue;
      let delivery = entries.get(event.id);
      if (!delivery) {
        delivery = { id: event.id, title: event.title, milestones: [] };
        entries.set(event.id, delivery);
      }
      delivery.milestones.push(event);
    }
    return result([...entries.values()]);
  }

  const byId = new Map();
  for (const record of source.entries) {
    if (localDay(record.when) === date) byId.set(record.id, record);
  }
  const entries = [...byId.values()];
  if (observedDiary) return { state: 'unknown', count: entries.length || null, level: 'partial', entries };
  return result(entries);
}

function result(entries) {
  const count = entries.length;
  return { state: 'complete', count, level: Math.min(count, 4), entries };
}

export function projectRecords(sources, date) {
  const sourceStates = {};
  const entries = [];
  for (const source of Object.keys(recordSources)) {
    const day = projectDay(sources[source], source, date);
    sourceStates[source] = day.state;
    entries.push(...day.entries.map(record => ({ ...record, source })));
  }
  const states = Object.values(sourceStates);
  if (states.every(state => state === 'complete')) return result(entries);
  if (states.includes('complete') || entries.length) {
    return { state: 'partial', count: entries.length || null, level: 'partial', entries, sourceStates };
  }
  const state = states.includes('unknown') ? 'unknown' : 'unauthorized';
  return { state, count: null, level: state, entries, sourceStates };
}

export function projectActivity(sources, category, date, asOf) {
  if (date > asOf) return { state: 'future', count: null, level: 'future', entries: [] };
  return category === 'records' ? projectRecords(sources, date) : projectDay(sources.development, category, date);
}

export function summarizePeriod(days, category) {
  const items = new Set();
  const byStage = new Map(stages.map(stage => [stage.key, new Set()]));
  const coverage = { complete: 0, partial: 0, unknown: 0, unauthorized: 0, future: 0 };
  let activeDays = 0;
  for (const day of days) {
    coverage[day.state] += 1;
    if (day.entries.length) activeDays += 1;
    for (const item of day.entries) {
      items.add(category === 'records' ? JSON.stringify([item.source, item.id]) : item.id);
      for (const event of item.milestones ?? []) byStage.get(event.stage).add(item.id);
    }
  }
  return { count: items.size, activeDays, coverage,
    stageCounts: Object.fromEntries([...byStage].map(([key, ids]) => [key, ids.size])) };
}

export function dayLabel(day, category) {
  if (day.state === 'partial') return day.count === null ? stateLabels.partial : '已核对 ' + day.count + ' 条记录 · 部分覆盖';
  return day.count === null ? stateLabels[day.state] : day.count + ' ' + categories[category].unit;
}
