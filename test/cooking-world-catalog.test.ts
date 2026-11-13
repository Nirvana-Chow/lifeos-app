import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import {getRecipe, listRecipes} from '../src/cooking/catalog.ts';
import {rankRecipes, suggestionGroup} from '../src/cooking/filter.ts';

const original = JSON.parse(readFileSync('src/cooking/catalog-data.json', 'utf8'));
const world = () => listRecipes().filter(recipe => !original.some((old: {id: string}) => old.id === recipe.id));

test('twenty world recipes preserve the original 357 recipes byte-for-byte and remain uniquely traceable', () => {
  assert.equal(createHash('sha256').update(readFileSync('src/cooking/catalog-data.json')).digest('hex'), 'eb661761dfe3fb3ababc9efd2264592de998ef8bc6cffa427dae9fad0c5c6ad9');
  for (const recipe of original) assert.deepEqual(getRecipe(recipe.id), recipe);
  assert.equal(world().length, 20);
  assert.equal(new Set(listRecipes().map(recipe => recipe.id)).size, 377);
  assert.equal(new Set(world().map(recipe => recipe.name)).size, 20);
  const regions = new Set<string>();
  for (const summary of world()) {
    const recipe = getRecipe(summary.id)!;
    assert.match(recipe.id, /^[a-f0-9]{16}$/);
    assert.ok(recipe.referenceOnly);
    assert.ok(recipe.originalName);
    assert.ok(recipe.cuisine);
    regions.add(recipe.cuisine!);
    assert.match(recipe.sourceUrl, /^https:\/\/en\.wikibooks\.org\/w\/index\.php\?title=Cookbook%3A[^&]+&oldid=\d+$/);
    assert.equal(recipe.attribution?.license, 'CC BY-SA 4.0');
    assert.equal(recipe.attribution?.licenseUrl, 'https://creativecommons.org/licenses/by-sa/4.0/');
    assert.match(recipe.attribution?.authorsUrl ?? '', /action=history$/);
    assert.match(recipe.attribution?.changes ?? '', /AI.*中文/);
    assert.ok(recipe.ingredients.length > 1);
    assert.deepEqual(recipe.sections.map(section => section.title), ['必备原料和工具', '计算', '操作', '附加内容']);
    assert.ok(recipe.sections[1]!.lines.some(line => line.startsWith('份量：')));
    assert.ok(recipe.sections[1]!.lines.some(line => line.startsWith('总用时：')));
    assert.ok(recipe.sections[2]!.lines.length >= 3);
    assert.equal('sections' in summary, false);
    assert.equal('attribution' in summary, false);
  }
  assert.ok(regions.size >= 10);
});

test('world names and regions work with category/ingredient filters and rotating suggestions', () => {
  assert.equal(rankRecipes(listRecipes(), {keyword:'Ratatouille'})[0]?.recipe.name, '法式炖蔬菜');
  assert.ok(rankRecipes(listRecipes(), {keyword:'墨西哥'}).length >= 2);
  const matches = rankRecipes(listRecipes(), {keyword:'Gazpacho', category:'soup', ingredients:['番茄']});
  assert.equal(matches.length, 1);
  assert.equal(matches[0]!.recipe.name, '西班牙番茄冷汤');
  assert.deepEqual(matches[0]!.matchedIngredients, ['番茄']);
  assert.deepEqual(rankRecipes(listRecipes(), {keyword:'Gazpacho', category:'dessert'}), []);
  assert.equal(new Set(Array.from({length:7}, (_, group) => suggestionGroup(rankRecipes(world()), group)).flat().map(match => match.recipe.id)).size, 20);
});

test('world source revisions and adapted data match their separate license manifest', () => {
  const provenance = JSON.parse(readFileSync('third-party/wikibooks/provenance.json', 'utf8'));
  assert.equal(provenance.license, 'CC BY-SA 4.0');
  assert.equal(createHash('sha256').update(readFileSync('third-party/wikibooks/LICENSE')).digest('hex'), provenance.licenseSha256);
  assert.equal(createHash('sha256').update(readFileSync(provenance.adaptation.localPath)).digest('hex'), provenance.adaptation.sha256);
  assert.equal(provenance.pages.length, 20);
  for (const page of provenance.pages) {
    const recipe = getRecipe(page.id)!;
    assert.equal(recipe.sourceUrl, page.sourceUrl);
    assert.equal(recipe.attribution?.authorsUrl, page.authorsUrl);
    assert.equal(new URL(page.sourceUrl).searchParams.get('oldid'), String(page.revision));
    assert.equal(createHash('sha256').update('wikibooks:' + page.title).digest('hex').slice(0,16), page.id);
    assert.match(page.upstreamWikitextSha256, /^[a-f0-9]{64}$/);
  }
});

function historyPage(identity: unknown) {
  const mod = {exports:{} as {default:(input:{searchParams:Promise<{recipe?:string}>}) => Promise<any>}};
  const jsx = (type: unknown, props: unknown) => ({type, props});
  const imports: Record<string, unknown> = {
    'react/jsx-runtime':{jsx, jsxs:jsx},
    'next/headers':{headers:async() => new Headers()},
    'next/navigation':{redirect:() => {throw Error('login required');}, notFound:() => {throw Error('not found');}},
    catalog:{getRecipe}, 'log-workbench':{CookingHistoryPage:'history'},
    runtime:{readPlatformPagePrincipal:async() => identity},
  };
  const output = ts.transpileModule(readFileSync('app/personal/cooking/history/page.tsx', 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require', 'module', 'exports', output)((name:string) => imports[name.startsWith('.') ? name.split('/').at(-1)! : name], mod, mod.exports);
  return (recipe?:string) => mod.exports.default({searchParams:Promise.resolve({recipe})});
}

test('world references cannot seed the existing cooking pin contract, while original pins remain usable', async () => {
  assert.equal(world().length, 20);
  const page = historyPage({ownerId:'synthetic-owner'});
  await assert.rejects(page(world()[0]!.id), /not found/);
  const old = original[0];
  assert.deepEqual((await page(old.id)).props.recipe, {id:old.id, name:old.name, sourceUrl:old.sourceUrl});
  assert.equal((await page()).props.recipe, null);
  await assert.rejects(historyPage(null)(world()[0]!.id), /login required/);
});
