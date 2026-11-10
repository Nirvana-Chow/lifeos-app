import assert from 'node:assert/strict';
import test from 'node:test';
import {ingredientTerms, rankRecipes, suggestionGroup} from '../src/cooking/filter.ts';

const recipes = [
  {id:'tomato-eggs', name:'西红柿炒鸡蛋', category:'vegetable_dish', difficulty:1, ingredients:['西红柿', '鸡蛋']},
  {id:'eggs', name:'煎鸡蛋', category:'breakfast', difficulty:1, ingredients:['鸡蛋']},
  {id:'potatoes', name:'酸辣土豆丝', category:'vegetable_dish', difficulty:2, ingredients:['土豆', '小米辣']},
  {id:'chicken', name:'炒鸡肉', category:'meat_dish', difficulty:1, ingredients:['鸡肉', '葱']},
  {id:'seaweed', name:'紫菜蛋花汤', category:'soup', difficulty:2, ingredients:['紫菜', '鸡蛋']},
  {id:'cake', name:'巴斯克蛋糕', category:'dessert', difficulty:3, ingredients:['鸡蛋', '奶酪']},
  {id:'fried-rice', name:'蛋炒饭', category:'staple', difficulty:1, ingredients:['米饭', '鸡蛋']},
  {id:'tomato-sauce', name:'烤蘑菇', category:'vegetable_dish', difficulty:1, ingredients:['蘑菇', '番茄酱']},
];

test('ingredient terms accept common separators, preserve the entered name and deduplicate aliases', () => {
  assert.deepEqual(ingredientTerms(' 番茄，鸡蛋、马铃薯; 西红柿\n土豆 '), ['番茄','鸡蛋','马铃薯']);
});

test('ingredient results favor more matches and only report ingredients found in the source', () => {
  const results = rankRecipes(recipes, {ingredients:['番茄','鸡蛋','苹果']});
  assert.equal(results[0]?.recipe.id, 'tomato-eggs');
  assert.deepEqual(results[0]?.matchedIngredients, ['番茄','鸡蛋']);
  assert.equal(results.some(result => result.recipe.id === 'chicken'), false);
  assert.equal(results.some(result => result.matchedIngredients.includes('苹果')), false);
  assert.deepEqual(rankRecipes(recipes, {ingredients:['苹果']}), []);
});

test('category and name filters stay in scope and do not misread chicken as eggs', () => {
  assert.deepEqual(rankRecipes(recipes, {category:'vegetable_dish', keyword:'番茄炒'}).map(result => result.recipe.id), ['tomato-eggs']);
  assert.deepEqual(rankRecipes(recipes, {category:'vegetable_dish', ingredients:['马铃薯']}).map(result => result.recipe.id), ['potatoes']);
  assert.deepEqual(rankRecipes(recipes, {ingredients:['鸡肉']}).map(result => result.recipe.id), ['chicken']);
  assert.deepEqual(rankRecipes(recipes, {category:'soup', ingredients:['土豆']}), []);
  assert.deepEqual(rankRecipes(recipes, {ingredients:['番茄']}).map(result => result.recipe.id), ['tomato-eggs']);
  assert.deepEqual(rankRecipes(recipes, {ingredients:['番茄酱']}).map(result => result.recipe.id), ['tomato-sauce']);
});

test('starter picks are everyday dishes and rotating avoids repeats until all candidates are shown', () => {
  const results = rankRecipes(recipes);
  assert.equal(results[0]?.recipe.id, 'tomato-eggs');
  const first = suggestionGroup(results, 0);
  const second = suggestionGroup(results, 1);
  const third = suggestionGroup(results, 2);
  assert.deepEqual([first.length, second.length, third.length], [3, 3, 2]);
  assert.equal(new Set([...first,...second,...third].map(result => result.recipe.id)).size, 8);
  assert.deepEqual(suggestionGroup(results, 3), first);
  assert.deepEqual(suggestionGroup([], 0), []);
});
