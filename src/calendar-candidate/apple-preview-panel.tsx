'use client';

import {useEffect, useRef, useState, type FormEvent} from 'react';
import {Button} from '../ui-review/ui/button';
import type {ApplePreviewAvailability, ApplePreviewResult} from './apple-preview-http';
import {shiftCalendarDate} from './personal-projection';
import s from './personal-workbench.module.css';

const endpoint = '/api/platform/personal/calendar/apple-preview';
const reasons = {
  'not-connected': '未连接 Apple 日历。当前没有可用的只读连接。',
  'not-authorized': 'Apple 日历连接尚未授权给当前私人空间。',
  unreadable: 'Apple 日历连接暂不可读取。',
  'no-readable-calendar': '当前没有已授权且可读取的普通 Apple 日历。',
};
const actions = {create: '拟新增', update: '拟更新', unchanged: '无变化', unverified: '对账待核实'};

export function AppleCalendarPreview({month, timeZone}: {month: string; timeZone: string}) {
  const [availability, setAvailability] = useState<ApplePreviewAvailability>();
  const [result, setResult] = useState<ApplePreviewResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  function reset() {
    active.current?.abort();
    setResult(undefined);
    setError('');
    setBusy(false);
  }

  async function read(query?: URLSearchParams) {
    reset();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    try {
      const response = await fetch(query ? endpoint + '?' + query.toString() : endpoint, {
        credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403 || response.status >= 500) {
        if (controller.signal.aborted) return;
        setAvailability(undefined);
        setError(response.status < 500 ? '当前会话或读取授权无法核对，请重新读取连接状态。' : 'Apple 日历读取暂不可用。');
        return;
      }
      if (!response.ok) throw Error();
      const value = await response.json();
      if (controller.signal.aborted) return;
      if (query) {
        if (!value || (value.status === 'ready' ? !Array.isArray(value.rows) : value.status !== 'blocked')) throw Error();
        setResult(value);
      } else {
        if (!value || (value.status === 'ready' ? !Array.isArray(value.calendars) : !Object.hasOwn(reasons, value.status))) throw Error();
        setAvailability(value);
      }
    } catch {
      if (!controller.signal.aborted) setError(query ? '预演未完成，请核对日历、日期和时区。' : '无法核对 Apple 日历连接状态。');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void read(new URLSearchParams(Object.fromEntries(['calendar', 'from', 'to', 'timeZone'].map(key => [key, String(form.get(key) ?? '')]))));
  }

  const start = month + '-01';
  return <details className={s.applePreview} onToggle={event => {
    setAvailability(undefined);
    if (event.currentTarget.open) void read();
    else reset();
  }}>
    <summary>Apple 日历预演</summary>
    <div className={s.sourceLine}>
      {busy && <p role="status">正在核对 Apple 日历…</p>}
      {error && <p role="alert">{error}</p>}
      {availability && availability.status !== 'ready' && <p role="status">{reasons[availability.status]}</p>}
      {availability?.status !== 'ready' && !busy && <Button variant="outline" onClick={() => void read()}>重新核对连接</Button>}
    </div>
    {availability?.status === 'ready' && <form className={s.toolbar} onSubmit={preview} onChange={reset}>
      <label>Apple 日历<select name="calendar" aria-label="Apple 日历" required defaultValue=""><option value="" disabled>请选择日历</option>
        {availability.calendars.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.label}</option>)}
      </select></label>
      <label>开始日期<input type="date" name="from" defaultValue={start} required/></label>
      <label>结束日期（不含）<input type="date" name="to" defaultValue={shiftCalendarDate(start, 7)} required/></label>
      <label>预演时区<input name="timeZone" defaultValue={timeZone} required/></label>
      <Button type="submit" variant="outline" disabled={busy}>查重预览</Button>
    </form>}
    {result?.status === 'blocked' && <p role="alert">覆盖、来源身份或重复实例未通过核对，预演已暂停。</p>}
    {result?.status === 'ready' && <section aria-label="Apple 日历预演结果">
      <p role="status">{result.rows.length} 条 · {result.window.timeZone} · 自动叠加已排除 · 只读预演</p>
      {result.comparison === 'unavailable' && <p>缺少可核实的已有记录基线，暂无法判断拟新增或更新。</p>}
      <ul>{result.rows.map(({title, schedule, action}, index) => <li key={index}>
        <strong>{title}</strong> · {actions[action]} · {schedule.kind === 'all-day'
          ? `${schedule.startDate} 至 ${schedule.endDate}（结束日不含）`
          : `${schedule.startAt} 至 ${schedule.endAt} · ${schedule.timeZone}`}
      </li>)}</ul>
    </section>}
  </details>;
}
