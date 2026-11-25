import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('review shell keeps a single breadcrumb and only the selected dimension in the sidebar',()=>{
 const source=readFileSync(new URL('../src/ui-review/workspace.tsx',import.meta.url),'utf8');
 assert.match(source,/aria-label="切换模块"/);
 assert.match(source,/aria-label=\{activeModule\.label\}/);
 assert.match(source,/activeModule\.pages\.map/);
 assert.match(source,/<OwnerModuleLinks links=\{activeModule\.links\}/);
 assert.doesNotMatch(source,/lo-header-context/);
 assert.equal((source.match(/aria-label="浏览位置"/g)||[]).length,1);
});
