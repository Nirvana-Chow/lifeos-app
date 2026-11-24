import {Button} from '../ui-review/ui/button';
import type {PersonRow} from './projection';
import styles from './PeopleOverview.module.css';

export function PeopleOverview({people, allPeople, onOpen}: {
  people: readonly PersonRow[];
  allPeople: readonly PersonRow[];
  onOpen: (id: string) => void;
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
        return <li key={person.id} className={styles.card}>
          <h2>{person.title}</h2>
          {label && <p className={styles.meta}>{label}</p>}
          {person.summary.length > 0 && <p className={styles.meta}>{person.summary.join(' · ')}</p>}
          <Button
            variant="outline"
            aria-label={`查看 ${person.title}${label ? '（' + label + '）' : ''}`}
            onClick={() => onOpen(person.id)}
          >查看档案</Button>
        </li>;
      })}</ul>}
  </section>;
}
