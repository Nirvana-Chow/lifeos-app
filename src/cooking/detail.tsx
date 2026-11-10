import { ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import type { Recipe } from './catalog';
import styles from './workspace.module.css';

const sectionNames = {
  必备原料和工具: { id:'cooking-ingredients', title:'食材和工具' },
  计算: { id:'cooking-amounts', title:'用量和准备' },
  操作: { id:'cooking-steps', title:'烹饪步骤' },
  附加内容: { id:'cooking-notes', title:'补充提示' },
} as const;

type Entry = { text: string; notes: string[] };
type Group = { title: string; entries: Entry[] };

function groupLines(lines: string[]) {
  const groups: Group[] = [{ title:'', entries:[] }];
  for (const line of lines) {
    const group = groups[groups.length - 1];
    const text = line.trim();
    if (!text) continue;
    if (text.startsWith('# ')) {
      groups.push({ title:text.slice(2), entries:[] });
      continue;
    }
    const previous = group.entries[group.entries.length - 1];
    if (line.startsWith('  ') && previous) previous.notes.push(text);
    else group.entries.push({ text, notes:[] });
  }
  return groups.filter(group => group.entries.length > 0);
}

export function CookingRecipe({ recipe, categoryLabel }: {recipe: Recipe; categoryLabel: string}) {
  const sections = recipe.sections.flatMap(section => {
    const label = sectionNames[section.title as keyof typeof sectionNames];
    const groups = groupLines(section.lines);
    return label && groups.length ? [{ ...label, groups }] : [];
  });

  return (
    <article className={styles.recipe}>
      <header className={styles.recipeHeader}>
        <Link href="/personal/cooking" className={styles.recipeLink}>
          <ArrowLeft aria-hidden="true" size={17} />返回菜谱
        </Link>
        <p className={styles.meta}>{categoryLabel} · 难度 {recipe.difficulty}/5</p>
        <nav className={styles.recipeNav} aria-label="菜谱章节">
          {sections.map(section => (
            <a key={section.id} className={styles.recipeLink} href={`#${section.id}`}>{section.title}</a>
          ))}
        </nav>
        <div className={styles.footer}>
          <span>来源：HowToCook 1.6.0</span>
          <a href={recipe.sourceUrl} target="_blank" rel="noreferrer">
            查看原菜谱<ExternalLink aria-hidden="true" size={14} />
          </a>
        </div>
      </header>

      {sections.map(section => (
        <section className={styles.recipeSection} key={section.id} aria-labelledby={section.id}>
          <h2 id={section.id}>{section.title}</h2>
          {section.groups.map((group, index) => {
            const List = section.id === 'cooking-steps' ? 'ol' : 'ul';
            return (
              <div key={index} className={styles.recipeGroup}>
                {group.title && <h3>{group.title}</h3>}
                <List className={styles.recipeList}>
                  {group.entries.map((entry, entryIndex) => (
                    <li key={entryIndex}>
                      {entry.text}
                      {entry.notes.length > 0 && (
                        <ul>{entry.notes.map((note, noteIndex) => <li key={noteIndex}>{note}</li>)}</ul>
                      )}
                    </li>
                  ))}
                </List>
              </div>
            );
          })}
        </section>
      ))}

    </article>
  );
}
