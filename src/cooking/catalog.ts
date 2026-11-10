import catalogData from './catalog-data.json' with {type: 'json'};

export type RecipeSummary = {
  id: string;
  name: string;
  category: string;
  difficulty: number;
  ingredients: string[];
};

export type Recipe = RecipeSummary & {
  sourceUrl: string;
  sections: {title: string; lines: string[]}[];
};

export const categories: {id: string; label: string}[] = [
  {id: 'vegetable_dish', label: '素菜'},
  {id: 'meat_dish', label: '荤菜'},
  {id: 'aquatic', label: '水产'},
  {id: 'staple', label: '主食'},
  {id: 'breakfast', label: '早餐'},
  {id: 'soup', label: '汤品'},
  {id: 'dessert', label: '甜品'},
  {id: 'drink', label: '饮品'},
  {id: 'condiment', label: '调料'},
  {id: 'semi-finished', label: '半成品'},
];

const recipes: Recipe[] = catalogData;
const byId = new Map(recipes.map(recipe => [recipe.id, recipe]));

export function listRecipes(): RecipeSummary[] {
  return recipes.map(({id, name, category, difficulty, ingredients}) => ({
    id,
    name,
    category,
    difficulty,
    ingredients,
  }));
}

export function getRecipe(id: string): Recipe | undefined {
  return byId.get(id);
}
