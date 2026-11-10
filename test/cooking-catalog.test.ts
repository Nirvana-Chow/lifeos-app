import assert from 'node:assert/strict';
import {test} from 'node:test';
import {categories, getRecipe, listRecipes} from '../src/cooking/catalog.ts';

test('the pinned catalog exposes all ten categories and preserves separate same-name recipes', () => {
  const summaries = listRecipes();
  assert.equal(summaries.length, 357);
  assert.equal(new Set(summaries.map(({id}) => id)).size, summaries.length);
  assert.deepEqual(
    Object.fromEntries(categories.map(({id}) => [id, summaries.filter(recipe => recipe.category === id).length])),
    {vegetable_dish: 60, meat_dish: 103, aquatic: 27, staple: 58, breakfast: 25, soup: 23, dessert: 19, drink: 23, condiment: 9, 'semi-finished': 10},
  );
  const ribSoups = summaries.filter(({name}) => name === '陈皮排骨汤');
  assert.equal(ribSoups.length, 2);
  assert.notEqual(getRecipe(ribSoups[0].id)?.sourceUrl, getRecipe(ribSoups[1].id)?.sourceUrl);
  assert.equal(getRecipe('missing'), undefined);
});

test('recipe summaries carry searchable ingredients while instructions remain in recipe details', () => {
  const summary = listRecipes().find(({name}) => name === '西红柿炒鸡蛋');
  assert.ok(summary);
  assert.equal(summary.difficulty, 2);
  assert.ok(summary.ingredients.includes('鸡蛋'));
  assert.ok(summary.ingredients.includes('西红柿'));
  assert.equal('sections' in summary, false);
  const recipe = getRecipe(summary.id);
  assert.ok(recipe);
  assert.match(recipe.sourceUrl, /^https:\/\/github\.com\/Anduin2017\/HowToCook\/blob\/a0b14bd388ee996943173679c3a7c9db7da04a6c\/dishes\//);
  assert.deepEqual(recipe.sections.map(({title}) => title), ['必备原料和工具', '计算', '操作', '附加内容']);
  assert.ok(recipe.sections.find(({title}) => title === '计算')?.lines.includes('鸡蛋 = 1.5 个 * 份数，向上取整'));
  assert.ok(recipe.sections.find(({title}) => title === '操作')?.lines.some(line => line.includes('翻炒')));
});

test('ingredient counts and recipe tables remain readable without Markdown', () => {
  const fries = listRecipes().find(({name}) => name === '炸薯条');
  assert.ok(fries);
  assert.deepEqual(fries.ingredients, ['半成品薯条']);
  const cod = listRecipes().find(({name}) => name === '微波葱姜黑鳕鱼');
  assert.ok(cod);
  assert.ok(getRecipe(cod.id)?.sections.some(({lines}) => lines.some(line =>
    line === '鱼类：海鲈鱼 · 是否切片：整条 · 重量：450g · 微波时间：6.5 分钟',
  )));
});

test('every published recipe contains the source headings and no image or HTML markup', () => {
  for (const summary of listRecipes()) {
    assert.match(summary.id, /^[a-f0-9]{16}$/);
    assert.ok(Number.isInteger(summary.difficulty) && summary.difficulty >= 1 && summary.difficulty <= 5);
    const recipe = getRecipe(summary.id);
    assert.ok(recipe);
    assert.deepEqual(recipe.sections.map(({title}) => title), ['必备原料和工具', '计算', '操作', '附加内容'], summary.name);
    for (const section of recipe.sections) {
      assert.ok(section.lines.every(line => !/!\[|<\/?[a-z]|<!--/i.test(line)), summary.name);
    }
  }
});
