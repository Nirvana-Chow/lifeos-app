import test from 'node:test';
import assert from 'node:assert/strict';
import { reuiGridRendered } from './helpers/task-grid-browser-driver.ts';
const valid = { renderer: 'reui', failures: 0, grids: 1, expectedRows: 1, declaredRows: 2, headers: ['待办', '状态', '到期日', '项目', '领域', '详情'], renderedRows: 1, cellsPerRow: [6], nativeTitle: true, visible: true };
test('ReUI native oracle requires its visible semantic grid and exact six-column row model', () => {
  assert.equal(reuiGridRendered(valid), true);
  for (const bad of [{ renderer: null }, { grids: 0 }, { failures: 1 }, { renderedRows: 0 }, { declaredRows: 4 }, { nativeTitle: false }, { visible: false }, { headers: ['待办'] }, { cellsPerRow: [5] }]) {
    assert.equal(reuiGridRendered({ ...valid, ...bad }), false, JSON.stringify(bad));
  }
});
test('a screen-reader fallback or canvas alone cannot satisfy the selected ReUI oracle', () => {
  assert.equal(reuiGridRendered({ ...valid, grids: 0, nativeTitle: false, renderedRows: 0 }), false);
  assert.equal(reuiGridRendered({ ...valid, renderer: 'vtable' }), false);
});
