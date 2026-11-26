'use client';

import {ArrowUpRight} from 'lucide-react';
import {useEffect, useState, type ReactNode} from 'react';
import {readPersonalCalendarSnapshot, readPersonalCalendarStatus} from '../calendar-candidate/personal-client.ts';
import {dateInCalendarZone, shiftCalendarDate} from '../calendar-candidate/personal-projection.ts';
import {loadRecentMemos} from '../personal-journal/recent-memos.ts';
import type {TaskRow, WorkspaceState} from './contract.ts';
import {RequirementProgressCard} from './requirement-progress-card';
import {filterTasks, metricTaskFilter} from './selectors.ts';
import {Frame,FramePanel} from '../business-reui/frame';
import {Alert,AlertDescription} from './reui/alert';
import {Badge} from './ui/badge';
import {Button} from './ui/button';
import s from './daily-overview.module.css';

type Source<T> = {state:'loading'|'unavailable'} | {state:'ready'; value:T};
const shanghai = 'Asia/Shanghai';
const clock = new Intl.DateTimeFormat('zh-CN', {timeZone:shanghai,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});

async function upcoming(fetcher: typeof fetch, scope: string) {
  const binding = await readPersonalCalendarStatus(fetcher);
  if (!binding.configured || JSON.stringify([binding.ownerId,binding.spaceId]) !== scope) throw Error();
  const from = dateInCalendarZone(new Date().toISOString(), shanghai);
  const snapshot = await readPersonalCalendarSnapshot(fetcher, binding, {
    from, to:shiftCalendarDate(from,7), timeZone:shanghai, search:'', calendarKind:'event', limit:40,
  });
  const current = await readPersonalCalendarStatus(fetcher);
  if (!current.configured || JSON.stringify([current.ownerId,current.spaceId]) !== scope) throw Error();
  const entries = new Map(snapshot.entries.map(row=>[row.id,row]));
  const observedDay = dateInCalendarZone(snapshot.observedAt, shanghai);
  const rows = snapshot.projection.occurrences.flatMap(row=>{
    const entry = entries.get(row.recordId), day = row.days.find(date=>date>=observedDay);
    const fields = entry?.fields;
    if (!fields || !day || fields.personal.calendarKind !== 'event' || !fields.personal.schedule) return [];
    const schedule = fields.personal.schedule;
    if (schedule.kind === 'all-day') return [{id:row.occurrenceId,title:fields.title,day, label:'全天', sortTime:''}];
    if (Date.parse(schedule.endAt)<=Date.parse(snapshot.observedAt)) return [];
    const started = Date.parse(schedule.startAt)<=Date.parse(snapshot.observedAt);
    return [{id:row.occurrenceId,title:fields.title,day, label:started?'进行中':clock.format(new Date(schedule.startAt)),sortTime:schedule.startAt}];
  }).sort((a,b)=>a.day.localeCompare(b.day)||a.sortTime.localeCompare(b.sortTime));
  return {rows:rows.slice(0,5), appleMissing:!snapshot.sources.some(source=>source.id==='apple-calendar'&&source.connected)};
}

function useSource<T>(scope:string|null, read:(fetcher:typeof fetch,scope:string)=>Promise<T>): Source<T> {
  const [result,setResult] = useState<{scope:string;state:Source<T>}|null>(null);
  useEffect(()=>{
    if (!scope) {setResult(null);return;}
    const verified = scope;
    let pending: AbortController | undefined;
    function refresh() {
      pending?.abort();
      setResult({scope:verified,state:{state:'loading'}});
      if (document.visibilityState === 'hidden') return;
      const controller = new AbortController();
      pending = controller;
      const {signal} = controller;
      void read((url,init)=>fetch(url,{...init,signal}),verified).then(
        value=>{if(!signal.aborted)setResult({scope:verified,state:{state:'ready',value}});},
        ()=>{if(!signal.aborted)setResult({scope:verified,state:{state:'unavailable'}});},
      );
    }
    refresh();
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    return ()=>{pending?.abort();window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[scope,read]);
  return !scope ? {state:'unavailable'} : result?.scope===scope ? result.state : {state:'loading'};
}

function OverviewPanel({title,action,children}: {title:string;action?:ReactNode;children:ReactNode}) {
  return <Frame asChild>
    <section aria-label={title}>
      <FramePanel className="p-0">
        <div className="lo-panel-heading"><h2>{title}</h2>{action}</div>
        {children}
      </FramePanel>
    </section>
  </Frame>;
}

export function DailyOverview({state,scope,showTasks,scheduleHref,journalHref,onRequirements,onTasks,renderTask}:{
  state:WorkspaceState;scope:string|null;showTasks:boolean;scheduleHref?:string;journalHref?:string;
  onRequirements:()=>void;onTasks:()=>void;renderTask:(row:TaskRow)=>ReactNode;
}) {
  const calendar = useSource(scope && scheduleHref ? scope : null,upcoming);
  const memos = useSource(scope && journalHref ? scope : null,loadRecentMemos);
  const tasks = showTasks && state.status === 'ready' ? filterTasks(state.data.tasks, metricTaskFilter('pending')) : null;
  const partial = state.status === 'ready' && state.data.coverage === 'partial';
  return <div className={s.overview}>
    <div className={s.previews}>
      <OverviewPanel title="未完待办" action={<Button variant="ghost" aria-label="查看全部未完待办" data-workspace-nav onClick={onTasks}>查看全部<ArrowUpRight size={18} aria-hidden="true"/></Button>}>
        {tasks?.length ? <div className={`lo-overview-task-list ${s.tasks}`}>{tasks.slice(0,6).map(renderTask)}</div>
          : <p className="lo-empty-compact">{!tasks || partial ? '未完待办暂不可用' : '暂无未完待办'}</p>}
        {partial && tasks?.length ? <p className={s.note}>仅显示已读取的待办</p> : null}
      </OverviewPanel>
      <OverviewPanel title="近期日程" action={scheduleHref && <Button variant="ghost" asChild><a href={scheduleHref}>查看日程</a></Button>}>
        {calendar.state === 'ready' ? <>
          {calendar.value.rows.length ? <ul className={s.rows}>{calendar.value.rows.map(row=><li key={row.id}><span>{row.title}</span><time dateTime={row.day}>{row.day} · {row.label}</time></li>)}</ul>
            : <p className="lo-empty-compact">未来 7 天暂无已读取的日程</p>}
          {calendar.value.appleMissing && <p className={s.note}><Badge variant="secondary">Apple 日历尚未连接</Badge></p>}
        </> : calendar.state === 'loading' ? <p className="lo-empty-compact" role="status">正在读取日程…</p>
          : <Alert role="status" className="mx-4 my-2 w-auto"><AlertDescription>近期日程暂不可用</AlertDescription></Alert>}
      </OverviewPanel>
    </div>
    <OverviewPanel title="最近思考" action={journalHref && <Button variant="ghost" asChild><a href={journalHref}>查看记录</a></Button>}>
      {memos.state === 'ready' ? memos.value.rows.length ? <ul className={`${s.rows} ${s.thoughts}`}>{memos.value.rows.map(row=><li key={row.id}>
        <div className={s.thoughtHeading}>
          <a href={row.href}>{row.title}</a>
          <div className={s.timestamps}>
            {row.recordedAt ? <time dateTime={row.recordedAt}>录入 {dateInCalendarZone(row.recordedAt,shanghai)} {clock.format(new Date(row.recordedAt))}</time> : <span className={s.date}>录入时间未知</span>}
            {row.occurredOn ? <time dateTime={row.occurredOn}>发生 {row.occurredOn}</time> : <span className={s.date}>发生日期未记录</span>}
          </div>
        </div>
        {row.text.trim() && row.text.trim() !== row.title.trim() && <p className={s.excerpt}>{row.text}</p>}
      </li>)}</ul> : <p className="lo-empty-compact">{memos.value.classificationPending?'部分记录分类待核对':'暂无已核对的随手记或思考'}</p> : memos.state === 'loading' ? <p className="lo-empty-compact" role="status">正在读取随手记…</p>
        : <Alert role="status" className="mx-4 my-2 w-auto"><AlertDescription>随手记暂不可用</AlertDescription></Alert>}
    </OverviewPanel>
    {scope && <RequirementProgressCard scope={scope} onOpen={onRequirements}/>}
  </div>;
}
