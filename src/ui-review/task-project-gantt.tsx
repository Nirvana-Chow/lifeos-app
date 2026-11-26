'use client';

import type { ReactNode } from 'react';
import type { PersonalPlanningFields } from '../personal-candidate/planning';
import { requirementSchedule } from '../requirements-candidate/planning';
import { Button } from './ui/button';
import styles from './task-project-gantt.module.css';

type Row = { id: string; title: string; dueOn?: string | null } & PersonalPlanningFields;
const dayInMilliseconds = 86_400_000;

function TimelineScale({ first, last }: { first: string | null; last: string | null }) {
  if (!first || !last) return null;
  const start = Date.parse(first);
  const days = Math.round((Date.parse(last) - start) / dayInMilliseconds);
  const midpoint = Math.round(days / 2);
  const hasRoomForMidpoint = days > 1 && midpoint / days <= 0.58;
  const offsets = days === 0 ? [0] : hasRoomForMidpoint ? [0, midpoint, days] : [0, days];

  return <div className={styles.axis}>
    <div className={styles.label} aria-hidden="true" />
    <div className={styles.scale} data-gantt-scale="">
      {offsets.map((offset, index) => {
        const date = new Date(start + offset * dayInMilliseconds).toISOString().slice(0, 10);
        const position = index === 0 ? 'start' : index === offsets.length - 1 ? 'end' : 'middle';
        return <time key={date} dateTime={date} data-position={position}
          style={{ left: `${offset / Math.max(1, days) * 100}%` }}>{date}</time>;
      })}
    </div>
  </div>;
}

/** Read-only date projection. Dates come only from the host's verified saved records. */
export function TaskProjectGantt<T extends Row>({ label, rows, partial, onShowTable, renderTitle }: {
  label: '待办' | '项目';
  rows: readonly T[];
  partial: boolean;
  onShowTable: () => void;
  renderTitle: (row: T) => ReactNode;
}) {
  const schedule = requirementSchedule(rows, new Map(rows.map(row => [
    row.id, { plannedStartOn: row.plannedStartOn ?? null, plannedEndOn: row.plannedEndOn ?? null },
  ])));
  // A deadline is a point, never a substitute for a missing plan endpoint.
  const deadlines = requirementSchedule(label === '待办' ? schedule.unscheduled : [], new Map(rows.map(row => [
    row.id, { plannedStartOn: row.dueOn ?? null, plannedEndOn: row.dueOn ?? null },
  ])));
  const deadlineIds = new Set(deadlines.scheduled.map(row => row.item.id));
  const undated = schedule.unscheduled.filter(row => !deadlineIds.has(row.id));
  const hasTimeline = schedule.scheduled.length > 0 || deadlines.scheduled.length > 0;
  const heading = schedule.scheduled.length ? `已排期 · ${schedule.scheduled.length} 项${label}` : '尚无完整排期';

  return <section className={styles.gantt} aria-label={`${label}甘特`}>
    <header>
      <h2>{heading}</h2>
      <Button variant="outline" onClick={onShowTable}>查看{label}表格</Button>
      {partial && <p role="status">当前仅显示已读取范围，完整排期数量尚不能确认。</p>}
    </header>
    <div className={styles.viewport} tabIndex={hasTimeline ? 0 : undefined}
      role={hasTimeline ? 'region' : undefined} aria-label={hasTimeline ? `${label}时间轴滚动区` : undefined}>
      {schedule.scheduled.length > 0 && <section className={styles.timeline} aria-label={`已排期${label}`}>
        <TimelineScale first={schedule.minOn} last={schedule.maxOn} />
        {schedule.scheduled.map(({ item, startOn, endOn, left, width }) =>
          <article className={styles.row} key={item.id} data-gantt-record={item.id}>
            <div className={styles.label}>{renderTitle(item)}</div>
            <div className={styles.track} role="img" aria-label={`计划 ${startOn} 至 ${endOn}`}>
              <span data-gantt-bar="" className={styles.bar} style={{
                left: `min(${left}%, calc(100% - 4px))`, width: `max(4px, ${width}%)`,
              }} />
              <span className={styles.dates}>
                <time dateTime={startOn}>{startOn}</time>
                {endOn !== startOn && <> — <time dateTime={endOn}>{endOn}</time></>}
              </span>
            </div>
          </article>
        )}
      </section>}
      {deadlines.scheduled.length > 0 && <section className={styles.timeline} aria-label="待办截止日期">
        <h3>仅截止日期 · {deadlines.scheduled.length} 项待办</h3>
        <TimelineScale first={deadlines.minOn} last={deadlines.maxOn} />
        {deadlines.scheduled.map(({ item, startOn, left }) =>
          <article className={styles.row} key={item.id} data-gantt-record={item.id}>
            <div className={styles.label}>{renderTitle(item)}</div>
            <div className={styles.track} role="img" aria-label={`截止 ${startOn}`}>
              <span data-gantt-milestone="" className={styles.milestone} style={{ left: `${left}%` }} />
              <span className={styles.dates}>截止 <time dateTime={startOn}>{startOn}</time></span>
            </div>
          </article>
        )}
      </section>}
      {label === '待办' && undated.length > 0 &&
        <section className={styles.unscheduled} aria-label="未完整排期待办">
          <h3>未完整排期 · {undated.length} 项待办</h3>
          {undated.map(item => <article className={styles.row} key={item.id} data-gantt-record={item.id}>
            <div className={styles.label}>{renderTitle(item)}</div>
            <span className={styles.metadata}>
              {item.plannedStartOn && `计划开始 ${item.plannedStartOn}`}
              {item.plannedStartOn && item.plannedEndOn && '；'}
              {item.plannedEndOn && `计划结束 ${item.plannedEndOn}`}
              {!item.plannedStartOn && !item.plannedEndOn && '尚未排期'}
            </span>
          </article>)}
        </section>
      }
      {label === '项目' && undated.length > 0 &&
        <p className={styles.empty}>{undated.length} 项项目未完整排期，可在表格中查看。</p>}
      {rows.length === 0 && <p className={styles.empty}>
        {partial ? `已读取范围内没有符合条件的${label}` : `没有符合条件的${label}`}
      </p>}
    </div>
  </section>;
}
