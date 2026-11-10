import type { RecipeSummary } from './catalog.ts';

const aliases = [
  ['番茄', '西红柿'],
  ['马铃薯', '土豆'],
  ['洋山芋', '土豆'],
  ['卷心菜', '包菜'],
  ['圆白菜', '包菜'],
  ['高丽菜', '包菜'],
  ['地瓜', '红薯'],
  ['小葱', '葱'],
  ['香葱', '葱'],
  ['葱花', '葱'],
] as const;

const starters = [
  '西红柿炒鸡蛋',
  '紫菜蛋花汤',
  '酸辣土豆丝',
  '蛋炒饭',
  '手撕包菜',
  '可乐鸡翅',
];
const suggestionSize = 3;

type RecipeMatch = {
  recipe: RecipeSummary;
  matchedIngredients: string[];
};

type RecipeFilters = {
  category?: string;
  ingredients?: readonly string[];
  keyword?: string;
};

function normalize(text: string) {
  const normalized = text.normalize('NFKC').trim().toLowerCase();
  if (normalized === '菜花' || normalized === '椰菜花') return '花菜';
  return aliases.reduce(
    (value, [alias, name]) => value.replaceAll(alias, name),
    normalized,
  );
}

export function ingredientTerms(input: string) {
  const terms = new Map<string, string>();
  for (const part of input.normalize('NFKC').split(/[、,;\s]+/u)) {
    const key = normalize(part);
    if (key && !terms.has(key)) terms.set(key, part);
  }
  return [...terms.values()];
}

function starterRank(name: string) {
  const position = starters.indexOf(normalize(name));
  return position === -1 ? starters.length : position;
}

function ingredientMatches(ingredient: string, key: string) {
  if (ingredient === key) return true;
  if (key.length === 1) return false;
  const position = ingredient.indexOf(key);
  if (position < 0) return false;
  const after = ingredient.slice(position + key.length);
  return !/^(?:酱|汁|粉|膏|罐头|浓缩液|调味料|味)/u.test(after);
}

export function rankRecipes(
  recipes: readonly RecipeSummary[],
  { category, ingredients = [], keyword = '' }: RecipeFilters = {},
): RecipeMatch[] {
  const terms = ingredientTerms(ingredients.join('、')).map(term => ({ term, key:normalize(term) }));
  const nameQuery = normalize(keyword);
  const matches: RecipeMatch[] = [];
  for (const recipe of recipes) {
    if (category && recipe.category !== category) continue;
    if (nameQuery && !normalize(recipe.name).includes(nameQuery)) continue;
    const sourceIngredients = terms.length ? recipe.ingredients.map(normalize) : [];
    const matchedIngredients = terms.filter(({ key }) => sourceIngredients.some(
      ingredient => ingredientMatches(ingredient, key),
    )).map(({ term }) => term);
    if (terms.length && !matchedIngredients.length) continue;
    matches.push({ recipe, matchedIngredients });
  }
  return matches.sort((left, right) =>
    right.matchedIngredients.length - left.matchedIngredients.length
    || starterRank(left.recipe.name) - starterRank(right.recipe.name)
    || left.recipe.difficulty - right.recipe.difficulty
    || left.recipe.ingredients.length - right.recipe.ingredients.length
    || left.recipe.name.localeCompare(right.recipe.name, 'zh-CN')
    || left.recipe.id.localeCompare(right.recipe.id),
  );
}

export function suggestionGroup(matches: readonly RecipeMatch[], group: number): RecipeMatch[] {
  const groups = Math.ceil(matches.length / suggestionSize);
  if (!groups) return [];
  const start = (group % groups) * suggestionSize;
  return matches.slice(start, start + suggestionSize);
}
