import Link from 'next/link';
import {Button} from '../ui-review/ui/button';
import type {PersonRow} from './projection';
import {relatedJournalHref,type RelatedJournals} from './journal-links';
import {linkedCalendarHref,type RelatedCalendarEvents} from './calendar-links';
import styles from './PeopleOverview.module.css';

export function PeopleOverview({people, allPeople, onOpen, journals, calendarEvents, calendarEnabled, journalEnabled, onBeforeNavigate}: {
  people: readonly PersonRow[];
  allPeople: readonly PersonRow[];
  onOpen: (id: string) => void;
  journals: RelatedJournals|null;
  calendarEvents: RelatedCalendarEvents|null;
  calendarEnabled: boolean;
  journalEnabled: boolean;
  onBeforeNavigate: () => boolean;
}) {
  const idsByName = new Map<string, string[]>();
  for (const person of allPeople) {
    const ids = idsByName.get(person.title) ?? [];
    ids.push(person.id);
    idsByName.set(person.title, ids);
  }
  const sameNameLabels = new Map<string, string>();
  for (const ids of idsByName.values()) {
    if (ids.length > 1) ids.forEach((id, index) => sameNameLabels.set(id, `同名档案 ${index + 1}`));
  }
  return <section aria-label="人物概览">
    {people.length === 0
      ? <p className={styles.empty}>{allPeople.length ? '没有符合搜索条件的人物。' : '暂无已确认人物。'}</p>
      : <ul className={styles.cards}>{people.map(person => {
        const label = sameNameLabels.get(person.id);
        const related = journals?.get(person.id) ?? [];
        const events=calendarEvents?.get(person.id)??[];
        return <li key={person.id} className={styles.card}>
          <h2>{person.title}</h2>
          {label && <p className={styles.meta}>{label}</p>}
          {person.summary.length > 0 && <p className={styles.meta}>{person.summary.join(' · ')}</p>}
          <Button
            variant="outline"
            aria-label={`查看 ${person.title}${label ? '（' + label + '）' : ''}`}
            onClick={() => onOpen(person.id)}
          >查看档案</Button>
          <details className={styles.related}>
            <summary>关联日程{calendarEvents&&`（${events.length}）`}</summary>
            <p>范围为站内明确关联的个人日程。</p>
            {!calendarEnabled ? <p>个人日程来源未开放。</p> : calendarEvents===null ? <p>关联日程暂时无法完整核对。</p> : events.length ? <ul>
              {events.map(event=><li key={event.id}>
                {event.date?<time dateTime={event.date}>{event.date}</time>:<span>未排期</span>}
                {' '}
                <Link href={linkedCalendarHref(event.id)} prefetch={false}
                  onNavigate={event=>{if(!onBeforeNavigate())event.preventDefault();}}>{event.title}</Link>
              </li>)}
            </ul> : <p>当前站内日程没有已确认的关联。</p>}
          </details>
          {journalEnabled && <details className={styles.related}>
            <summary>关联日记{journals && `（${related.length}）`}</summary>
            {journals===null ? <p>关联日记暂时无法核对。</p> : related.length ? <ul>
              {related.map(record => <li key={record.id}>
                {record.occurredOn ? <time dateTime={record.occurredOn}>{record.occurredOn}</time> : <span>日期未知</span>}
                {' '}
                <Link href={relatedJournalHref(record.id,person.id)} prefetch={false}
                  onNavigate={event=>{if(!onBeforeNavigate())event.preventDefault();}}>{record.title}</Link>
              </li>)}
            </ul> : <p>当前日记库没有已确认的关联。</p>}
          </details>}
        </li>;
      })}</ul>}
  </section>;
}
