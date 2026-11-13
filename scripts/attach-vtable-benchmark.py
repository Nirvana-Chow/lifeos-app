"""Attach a synthetic browser probe to a separate checkout after building its image."""
import pathlib,sys
target=pathlib.Path(sys.argv[1])
candidate=pathlib.Path(sys.argv[2])
helper=(candidate/'test/helpers/task-grid-performance-fixture.ts').read_text()
start=helper.index("import {privateRead,")
end=helper.index("const origin",start)
helper=helper[:start]+"""import type { Browser, BrowserContext, Page } from '@playwright/test';
type PrivateFixture = {browser:Browser;context:BrowserContext;page:Page;entries:readonly {id:string}[]};
async function privateRead(page:Page,path:string) {
  const result=await page.evaluate(async path=>{
    const response=await fetch(path,{credentials:'same-origin',cache:'no-store'});
    return {ok:response.ok,cache:response.headers.get('cache-control'),body:await response.json()};
  },path);
  assert.equal(result.ok,true);
  assert.match(result.cache??'',/private.*no-store/);
  return result.body;
}

"""+helper[end:]
# The frozen VTable application has no optional-column UI. Modern preparation
# belongs only to the ReUI probe; it must not survive the legacy projection.
column_setup="          // The A/B comparison intentionally retains all seven fields, even when\n"
count_setup="          const count=tab.locator('.lo-result-count');"
assert helper.count(column_setup)==1 and helper.count(count_setup)==1, 'Modern column preparation must be unique'
start=helper.index(column_setup)
end=helper.index(count_setup,start)
helper=helper[:start]+helper[end:]
helper=helper.replace("          await search.evaluate", "          await expect(tab.locator('.lo-screen-reader-table tbody tr')).toHaveCount(0);\n          await tab.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));\n          const emptyCanvas=await tab.locator('.lo-vtable canvas').first().evaluate(canvas=>(canvas as HTMLCanvasElement).toDataURL());\n          await search.evaluate")
start=helper.index('          const firstTitle=')
end=helper.index('          raw[mode].push',start)
helper=helper[:start]+"""          const accessibleRows=tab.locator('.lo-screen-reader-table tbody tr');
          await expect(accessibleRows).toHaveCount(rows);
          await expect(accessibleRows.first().locator('td').first()).toHaveText(/^合成性能待办 \d{4}$/);
          await tab.waitForFunction(emptyCanvas=>{
            const host=document.querySelector('.lo-vtable');
            if(host?.getAttribute('aria-busy')!=='false'||host.closest('.lo-table-wrap')?.querySelector('[role="alert"]'))return false;
            return Array.from(host.querySelectorAll('canvas')).some(canvas=>{
              if(!canvas.width||!canvas.height||!canvas.getBoundingClientRect().width)return false;
              return canvas.toDataURL()!==emptyCanvas && canvas.getContext('2d')?.getImageData(0,0,canvas.width,canvas.height).data.some((value,index)=>index%4===3&&value>0);
            });
          },emptyCanvas);
"""+helper[end:]
assert not any(marker in helper for marker in ('taskGridRoot','requireTaskGrid','列设置')), 'Legacy benchmark contains modern-only dependencies'
(target/'test/helpers/task-grid-performance-fixture.ts').write_text(helper)
p=target/'test/owner-recovery-browser.integration.test.ts'
s=p.read_text().replace('timeout:180000','timeout:300000')
s=s.replace("import {verifyPersonalWorkspace}", "import {measureTaskGrid} from './helpers/task-grid-performance-fixture.ts';\nimport {verifyPersonalWorkspace}")
needle=" }catch(error){const name=error instanceof Error"
assert s.count(needle)==1
s=s.replace(needle,"""  stage='vtable-performance';
  const snapshot=await page.evaluate(async()=>await (await fetch('/api/platform/personal/overview?today=2030-11-02')).json());
  const byTitle=(title:string)=>snapshot.items.find((item:{draft:{title?:string}})=>item.draft.title===title);
  const entries=['合成浏览器领域','合成浏览器项目','合成浏览器待办更正'].map(byTitle);
  must(snapshot.total===3&&entries.every(Boolean),'vtable-original-receipts');
  const fixture={browser,context,page,entries};
  const samples=[...await measureTaskGrid(fixture,100),...await measureTaskGrid(fixture,1000,100)];
  console.log('SYNTHETIC_GRID_PERFORMANCE '+JSON.stringify({sourceSha:proof.sourceSha,samples}));
"""+needle)
p.write_text(s)
