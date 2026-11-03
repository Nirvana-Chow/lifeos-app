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
start=helper.index('          const firstTitle=')
end=helper.index('          await tab.evaluate',start)
helper=helper[:start]+"""          await tab.waitForFunction(()=>{
            const host=document.querySelector('.lo-vtable');
            if(host?.getAttribute('aria-busy')!=='false'||host.closest('.lo-table-wrap')?.querySelector('[role="alert"]'))return false;
            return Array.from(host.querySelectorAll('canvas')).some(canvas=>{
              if(!canvas.width||!canvas.height||!canvas.getBoundingClientRect().width)return false;
              return canvas.getContext('2d')?.getImageData(0,0,canvas.width,canvas.height).data.some((value,index)=>index%4===3&&value>0);
            });
          });
"""+helper[end:]
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
