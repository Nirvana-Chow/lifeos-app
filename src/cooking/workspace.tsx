'use client';

import { ArrowRight, ChevronLeft, ChevronRight, RefreshCw, Shuffle, Utensils } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { Button } from '../ui-review/ui/button';
import type { RecipeSummary } from './catalog';
import { ingredientTerms, rankRecipes, suggestionGroup } from './filter';
import styles from './workspace.module.css';

const pageSize = 9;

export function CookingWorkspace({ recipes, categories }: {
  recipes: RecipeSummary[];
  categories: {id: string; label: string}[];
}) {
  const [ingredientInput, setIngredientInput] = useState('');
  const [category, setCategory] = useState('');
  const [keyword, setKeyword] = useState('');
  const [group, setGroup] = useState(0);
  const [page, setPage] = useState(0);
  const [randomPick, setRandomPick] = useState<RecipeSummary | null>(null);
  const catalogHeading = useRef<HTMLHeadingElement>(null);
  const ingredients = useMemo(() => ingredientTerms(ingredientInput), [ingredientInput]);
  const matches = useMemo(() => rankRecipes(recipes, { category, ingredients }), [recipes, category, ingredients]);
  const catalog = useMemo(() => {
    if (!keyword.trim()) return matches;
    return rankRecipes(recipes, { category, ingredients, keyword });
  }, [matches, recipes, category, ingredients, keyword]);
  const categoryLabels = new Map(categories.map(item => [item.id, item.label]));
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const recipe of recipes) counts.set(recipe.category, (counts.get(recipe.category) ?? 0) + 1);
    return counts;
  }, [recipes]);
  const suggestions = suggestionGroup(matches, group);
  const pageCount = Math.ceil(catalog.length / pageSize);
  const visible = catalog.slice(page * pageSize, (page + 1) * pageSize);

  function changePage(next: number) {
    setPage(next);
    catalogHeading.current?.focus();
  }

  return (
    <div className={styles.workspace}>
      <section className={styles.pickPanel} aria-labelledby="cooking-suggestion-heading">
        <div className={styles.sectionHead}>
          <div className={styles.sectionIntro}>
            <h2 id="cooking-suggestion-heading"><Utensils aria-hidden="true" size={19} />今天做什么</h2>
            <p>第一次做，先挑一道 1–2 星的菜。读完步骤，切好食材、备齐调料再开火。</p>
          </div>
          <div className={styles.actions}>
            <Button type="button" variant="outline" className={styles.control} disabled={!catalog.length}
              onClick={() => setRandomPick(catalog[Math.floor(Math.random() * catalog.length)]?.recipe ?? null)}>
              <Shuffle aria-hidden="true" />随机选一道
            </Button>
          {matches.length > 3 && (
            <Button type="button" variant="outline" className={styles.control}
              onClick={() => setGroup(current => current + 1)}>
              <RefreshCw aria-hidden="true" />换一批
            </Button>
          )}
          </div>
        </div>

        <div className={styles.categories} role="group" aria-label="菜谱分类">
          {[{id: '', label: '全部菜谱'}, ...categories].map(item => (
            <Button key={item.id} type="button" variant="outline" className={styles.category}
              aria-pressed={category === item.id} onClick={() => {
                setCategory(item.id);
                setGroup(0);
                setPage(0);
                setRandomPick(null);
              }}>
              <span>{item.label}</span><span className={styles.meta}>{item.id ? categoryCounts.get(item.id) ?? 0 : recipes.length}</span>
            </Button>
          ))}
        </div>
        <div className={styles.filters}>
          <label>
            手头食材
            <input type="search" maxLength={160} placeholder="例如：鸡蛋、番茄、土豆" value={ingredientInput}
              onChange={event => {
                setIngredientInput(event.target.value);
                setGroup(0);
                setPage(0);
                setRandomPick(null);
              }} />
          </label>
        </div>

        {randomPick && (
          <div className={styles.randomResult} role="status" aria-label="随机选菜结果">
            <span className={styles.meta}>这次试试</span>
            <Link href={`/personal/cooking/${randomPick.id}`} prefetch={false}>
              <strong>{randomPick.name}</strong><span>查看做法 <ArrowRight aria-hidden="true" size={16} /></span>
            </Link>
          </div>
        )}

        {suggestions.length ? (
          <ul className={styles.suggestions}>
            {suggestions.map(({ recipe, matchedIngredients }) => (
              <li key={recipe.id}>
                <Link className={styles.pick} href={`/personal/cooking/${recipe.id}`} prefetch={false}>
                  <span className={styles.pickCopy}>
                    <span className={styles.meta}>{categoryLabels.get(recipe.category)} · 难度 {recipe.difficulty}/5</span>
                    <strong>{recipe.name}</strong>
                    {matchedIngredients.length > 0 && (
                      <span className={styles.match}>匹配 {matchedIngredients.join('、')}</span>
                    )}
                  </span>
                  <ArrowRight aria-hidden="true" size={17} className={styles.pickArrow} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>暂时没有匹配的菜谱。可以给食材换个叫法，或切回全部分类。</p>
        )}
        {ingredients.length > 0 && matches.length > 0 && (
          <p className={styles.hint}>匹配仅供选菜，开做前请核对菜谱里的完整用料。</p>
        )}
      </section>

      <section className={styles.catalog} aria-labelledby="cooking-catalog-heading">
        <div className={styles.sectionHead}>
          <div className={styles.sectionIntro}>
            <h2 id="cooking-catalog-heading" ref={catalogHeading} tabIndex={-1}>菜谱库</h2>
            <p role="status">{catalog.length} 道{ingredients.length || category || keyword.trim() ? '匹配菜谱' : '菜谱'}</p>
          </div>
          <label className={styles.search}>
            搜索菜名
            <input type="search" maxLength={80} placeholder="例如：红烧排骨" value={keyword}
              onChange={event => {
                setKeyword(event.target.value);
                setPage(0);
                setRandomPick(null);
              }} />
          </label>
        </div>

        {visible.length ? (
          <ul className={styles.catalogList}>
            {visible.map(({ recipe }) => (
              <li key={recipe.id}>
                <Link className={styles.catalogLink} href={`/personal/cooking/${recipe.id}`} prefetch={false}>
                  <strong>{recipe.name}</strong>
                  <span className={styles.meta}>{categoryLabels.get(recipe.category)} · 难度 {recipe.difficulty}/5</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.empty}>没有找到符合当前筛选的菜谱。可以试试其他菜名或食材。</p>
        )}

        {pageCount > 1 && (
          <nav className={styles.pagination} aria-label="菜谱分页">
            <Button type="button" variant="outline" className={styles.control} disabled={page === 0}
              onClick={() => changePage(page - 1)}>
              <ChevronLeft aria-hidden="true" />上一页
            </Button>
            <span className={styles.meta} aria-live="polite">第 {page + 1} / {pageCount} 页</span>
            <Button type="button" variant="outline" className={styles.control} disabled={page + 1 === pageCount}
              onClick={() => changePage(page + 1)}>
              下一页<ChevronRight aria-hidden="true" />
            </Button>
          </nav>
        )}
      </section>

      <footer className={styles.footer}>
        <a href="https://github.com/Anduin2017/HowToCook/tree/1.6.0/tips" target="_blank" rel="noreferrer">
          下厨基础：备料、厨具与技巧
        </a>
        <span>做饭记录与照片待接入。</span>
      </footer>
    </div>
  );
}
