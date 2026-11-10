'use client';

import { ArrowRight, ChevronLeft, ChevronRight, RefreshCw, Utensils } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import { Button } from '../ui-review/ui/button';
import type { RecipeSummary } from './catalog';
import { ingredientTerms, rankRecipes, suggestionGroup } from './filter';
import { CookingRecordAction } from './log-action';
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
  const catalogHeading = useRef<HTMLHeadingElement>(null);
  const ingredients = useMemo(() => ingredientTerms(ingredientInput), [ingredientInput]);
  const matches = useMemo(() => rankRecipes(recipes, { category, ingredients }), [recipes, category, ingredients]);
  const catalog = useMemo(() => {
    if (!keyword.trim()) return matches;
    return rankRecipes(recipes, { category, ingredients, keyword });
  }, [matches, recipes, category, ingredients, keyword]);
  const categoryLabels = new Map(categories.map(item => [item.id, item.label]));
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
          {matches.length > 3 && (
            <Button type="button" variant="outline" className={styles.control}
              onClick={() => setGroup(current => current + 1)}>
              <RefreshCw aria-hidden="true" />换一批
            </Button>
          )}
        </div>

        <div className={styles.filters}>
          <label>
            手头食材
            <input type="search" maxLength={160} placeholder="例如：鸡蛋、番茄、土豆" value={ingredientInput}
              onChange={event => {
                setIngredientInput(event.target.value);
                setGroup(0);
                setPage(0);
              }} />
          </label>
          <label>
            菜谱分类
            <select value={category} onChange={event => {
              setCategory(event.target.value);
              setGroup(0);
              setPage(0);
            }}>
              <option value="">全部分类</option>
              {categories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
        </div>

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
        <CookingRecordAction />
      </footer>
    </div>
  );
}
