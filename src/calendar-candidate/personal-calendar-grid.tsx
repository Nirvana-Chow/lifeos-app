'use client';

import {useMemo} from 'react';
import {Button} from '../ui-review/ui/button';
import type {CalendarSnapshot} from './personal-client';
import {calendarWeekStart, dateInCalendarZone, shiftCalendarDate, type CalendarOccurrence, type CalendarRecord} from './personal-projection';
import s from './personal-calendar-grid.module.css';

const weekdays = ['周一','周二','周三','周四','周五','周六','周日'];

function civilTime(instant: string, zone: string) {
  const offset = /^([+-])(\d\d):(\d\d)$/.exec(zone);
  const offsetMinutes = offset ? (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3])) : 0;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: offset ? 'UTC' : zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(Date.parse(instant) + offsetMinutes * 60_000));
}

function timing(record: CalendarRecord, day: string, zone: string) {
  const fields = record.fields.personal;
  if (fields.calendarKind !== 'event' || !fields.schedule) return '';
  const schedule = fields.schedule;
  if (schedule.kind === 'all-day') return '全天';
  const start = dateInCalendarZone(schedule.startAt, zone), end = dateInCalendarZone(schedule.endAt, zone);
  const startTime = civilTime(schedule.startAt, zone), endTime = civilTime(schedule.endAt, zone);
  if (start === end) return startTime + '–' + endTime;
  if (day === start) return startTime + ' 起';
  if (day === end) return '至 ' + endTime;
  return '持续中';
}

type Item = {record: CalendarRecord; occurrence: CalendarOccurrence};

export function PersonalCalendarGrid({snapshot, mode, day, today, selectDay, openRecord}: {
  snapshot: CalendarSnapshot;
  mode: 'month' | 'week';
  day: string;
  today: string | null;
  selectDay: (day: string) => void;
  openRecord: (record: CalendarRecord) => void;
}) {
  const {from,to,timeZone} = snapshot.window;
  const start = mode === 'month' ? calendarWeekStart(from) : from;
  const weeks = mode === 'month' ? 6 : 1;
  const rows = useMemo(() => {
    const records = new Map(snapshot.entries.map(record => [record.id,record]));
    const byDay = new Map<string,Item[]>();
    for (const occurrence of snapshot.projection.occurrences) {
      const record = records.get(occurrence.recordId);
      if (!record) continue;
      for (const date of occurrence.days) {
        const items = byDay.get(date) ?? [];
        items.push({record,occurrence});
        byDay.set(date,items);
      }
    }
    for (const items of byDay.values()) items.sort((a,b) => {
      const order = ({record}: Item) => {
        const fields = record.fields.personal;
        return fields.calendarKind === 'event' && fields.schedule?.kind === 'timed' ? fields.schedule.startAt : '';
      };
      return order(a).localeCompare(order(b)) || a.record.fields.title.localeCompare(b.record.fields.title,'zh-CN');
    });
    return byDay;
  },[snapshot]);
  const selected = rows.get(day) ?? [];
  return <div className={s.view}>
    <table className={s.calendar} aria-label={mode === 'month' ? from.slice(0,7) + ' 月历' : from + ' 起的周历'}>
      <thead><tr>{weekdays.map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{Array.from({length:weeks},(_,week) => <tr key={week}>{weekdays.map((_,index) => {
        const date = shiftCalendarDate(start,week*7+index);
        const items = rows.get(date) ?? [];
        const covered = from <= date && date < to;
        return <td key={date} className={covered ? undefined : s.outside} data-selected={day===date || undefined}>
          {covered ? <button className={s.date} type="button" aria-label={`查看 ${date} 的日程`}
            aria-current={today === date ? 'date' : undefined} aria-pressed={day===date} onClick={() => selectDay(date)}>
            <time dateTime={date}>{Number(date.slice(8))}</time>
            {items.length > 0 && <span>{items.length} 条</span>}
          </button> : <time dateTime={date} aria-label={date + '（不在本月读取范围内）'}>{Number(date.slice(8))}</time>}
          {items.slice(0,2).map(({record,occurrence}) => <button type="button" key={occurrence.occurrenceId} className={s.chip}
            onClick={() => openRecord(record)} title={record.fields.title}>{record.fields.title}</button>)}
        </td>;
      })}</tr>)}</tbody>
    </table>
    {day >= from && day < to && <section className={s.agenda} aria-label="所选日期日程">
      <header><h3><time dateTime={day}>{day}</time></h3><span>{timeZone} · {selected.length} 条</span></header>
      {selected.length ? <ul>{selected.map(({record,occurrence}) => <li key={occurrence.occurrenceId}>
        <span>{timing(record,day,timeZone)}</span>
        <Button variant="ghost" type="button" onClick={() => openRecord(record)}>{record.fields.title}</Button>
      </li>)}</ul> : <p>已读取的来源中，这一天没有日程。</p>}
    </section>}
  </div>;
}
