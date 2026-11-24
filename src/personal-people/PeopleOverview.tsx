import {Button} from '../ui-review/ui/button';
import type {PersonRow} from './projection';
import styles from './PeopleOverview.module.css';

export function PeopleOverview({people, allPeople, onOpen}: {
  people: readonly PersonRow[];
  allPeople: readonly PersonRow[];
  onOpen: (id: string) => void;
}) {
  const names = new Map<string, number>();
  for (const person of allPeople) {
    names.set(person.title, (names.get(person.title) ?? 0) + 1);
  }
  return <section aria-label="人物概览">
    {people.length === 0
      ? <p className={styles.empty}>{allPeople.length ? '没有符合搜索条件的人物。' : '暂无已确认人物。'}</p>
      : <ul className={styles.cards}>{people.map(person => {
        const repeated = (names.get(person.title) ?? 0) > 1;
        return <li key={person.id} className={styles.card}>
          <h2>{person.title}</h2>
          {repeated && <p className={styles.meta}>人物 ID {person.id}</p>}
          {person.summary.length > 0 && <p className={styles.meta}>{person.summary.join(' · ')}</p>}
          {person.fields.text && <p className={styles.notes}>{person.fields.text}</p>}
          <Button
            variant="outline"
            aria-label={`查看 ${person.title}${repeated ? '（' + person.id + '）' : ''}`}
            onClick={() => onOpen(person.id)}
          >查看档案</Button>
        </li>;
      })}</ul>}
  </section>;
}
