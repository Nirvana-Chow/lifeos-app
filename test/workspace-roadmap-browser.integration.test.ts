import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp, mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {once} from 'node:events';
import test from 'node:test';
import {chromium, expect,type Page} from '@playwright/test';
import {renderedContrast} from './helpers/personal-contrast.ts';
import {readyHeading} from './helpers/private-business-browser-fixture.ts';

const source=resolve(import.meta.dirname,'..');
const ids=Array.from({length:7},(_,index)=>`${String(index+1).repeat(8)}-1111-4111-8111-${String(index+1).repeat(12)}`);
function entry(index:number,type:string,title:string,personal:unknown={type}){
 const id=ids[index];
 return {id,kind:type==='todo'?'todo':'inbox',revision:2,
  draft:type==='todo'?{title,notes:'Synthetic fixture only',status:'open',dueOn:null,personal}:{title,text:'Synthetic fixture only',occurredOn:null,disposition:'reference',personal},
  source:{id,system:'website',externalId:id,version:1,asOf:'2030-11-02T00:00:00Z',original:{marker:'personal-manual-v1',spaceId:'synthetic-space',type,input:{}}},
  syncState:'draft',externalStatus:null,createdAt:'2030-11-02T00:00:00Z',updatedAt:'2030-11-02T00:00:00Z'};
}
const ref=(index:number)=>({id:ids[index],sourceId:ids[index],revision:2});
const items=[entry(0,'domain','合成领域甲'),entry(1,'domain','合成领域乙'),
 entry(2,'project','合成项目甲',{type:'project',stage:'active',purpose:'advance',nextStep:'核对合成样例',domain:ref(0),topics:[]}),
 entry(3,'project','合成项目乙',{type:'project',stage:'planned',purpose:'explore',nextStep:'检查后续阶段',domain:ref(1),topics:[]}),
 entry(4,'todo','合成待办甲',{project:ref(2),domain:null,topics:[]}),entry(5,'todo','合成待办乙',{project:ref(3),domain:null,topics:[]}),
 entry(6,'topic','合成主题')];

// Enough explicit synthetic categories to exercise the native sticky viewport.
for(let i=0;i<35;i++)for(const [index,type,label] of [[0,'domain','领域'],[2,'project','项目']] as const){
 const id=`${(i+(type==='domain'?200:400)).toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`;
 const item=entry(index,type,'合成长'+label+i,type==='domain'?{type:'domain'}:{type:'project',stage:'active',purpose:'advance',nextStep:'合成下一步',domain:ref(0),topics:[]});
 items.push({...item,id,source:{...item.source,id,externalId:id}});
}
async function categoryHeaderPresentation(page:Page){
 await page.evaluate(()=>document.fonts.ready.then(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()))));
 const facts=await page.locator('[data-category-grid="reui"] thead').evaluate(head=>{
  const visible=(node:Element)=>{const box=node.getBoundingClientRect(),style=getComputedStyle(node);return box.width>0&&box.height>0&&style.visibility!=='hidden'&&style.display!=='none';};
  // Same nearest-first computed layer input as the original presentation oracle.
  // No effect is removed and no opaque ancestor short-circuits collection.
  const headers=Array.from(head.querySelectorAll('th')).filter(visible).filter(node=>node.textContent?.trim()).map(node=>{
   const layers=[];
   for(let current:Element|null=node;current;current=current.parentElement){const style=getComputedStyle(current);layers.push({backgroundColor:style.backgroundColor,backgroundImage:style.backgroundImage,mixBlendMode:style.mixBlendMode,backgroundBlendMode:style.backgroundBlendMode,opacity:style.opacity,filter:style.filter,backdropFilter:style.backdropFilter});}
   return {foreground:getComputedStyle(node).color,layers};
  });
  const style=getComputedStyle(head),surface=head.closest('[data-lifeos-surface="personal"]');
  return {headers,position:style.position,top:style.top,zIndex:style.zIndex,background:style.backgroundColor,surfaceBackground:surface?getComputedStyle(surface).backgroundColor:null,backdropFilter:style.backdropFilter};
 });
 assert.ok(facts.headers.length>0,'the real category header must be sampled');
 for(const header of facts.headers)assert.ok(renderedContrast(header.foreground,header.layers).contrast>=4.5,'category header contrast keeps the original 4.5 threshold');
 assert.equal(facts.position,'sticky');assert.equal(facts.top,'0px');assert.equal(facts.zIndex,'40');assert.equal(facts.backdropFilter,'none');
 assert.equal(facts.background,facts.surfaceBackground,'sticky header has the existing opaque surface background');assert.notEqual(facts.background,'rgba(0, 0, 0, 0)');
 const viewport=page.locator('[data-category-grid="reui"] [data-slot="data-grid-table-viewport"]'),head=viewport.locator('thead');
 const before=(await head.boundingBox())!.y;
 const moved=await viewport.evaluate(node=>new Promise<number>(resolve=>{node.scrollTop=300;requestAnimationFrame(()=>resolve(node.scrollTop));}));
 assert.ok(moved>0,'actual category rows scroll beneath the sticky header');
 assert.ok(Math.abs((await head.boundingBox())!.y-before)<=1,'native header stays fixed while category rows scroll');
 await viewport.evaluate(node=>node.scrollTop=0);
}

async function fixture(root:string){
 await mkdir(join(root,'app/personal'),{recursive:true});
 await Promise.all([
  ...['layout.tsx','globals.css','theme.css'].map(file=>cp(join(source,'app',file),join(root,'app',file))),
  cp(join(source,'app/personal/page.tsx'),join(root,'app/personal/page.tsx')),
  cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
  cp(join(source,'src'),join(root,'src'),{recursive:true}),
  symlink(join(source,'node_modules'),join(root,'node_modules')),
  symlink(join(source,'components'),join(root,'components')),
 ]);
 await writeFile(join(root,'src/platform/runtime.ts'),'export const readPlatformPagePrincipal=async()=>({id:"synthetic-owner"});export const readPlatformPasswordCapability=async()=>true;\n');
 const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],
  {cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
 return server;
}

test('OPT-IN synthetic roadmap, category navigation and topic settings use the shared workspace',{
 skip:process.env.RUN_AGENT_KEY_BROWSER_TESTS!=='1'&&'Requires native Chrome and disposable synthetic Next.js fixture',timeout:240_000,
},async t=>{
 const root=await mkdtemp(join(tmpdir(),'lifeos-roadmap-browser-'));
 const server=await fixture(root).catch(async error=>{await rm(root,{recursive:true,force:true});throw error;});
 const stopped=once(server,'exit');
 t.after(async()=>{server.kill('SIGTERM');await stopped;await rm(root,{recursive:true,force:true});});
 const origin=await new Promise<string>((accept,reject)=>{
  let text='';const timer=setTimeout(()=>reject(Error('Synthetic roadmap fixture did not start')),30000);
  server.once('exit',code=>{clearTimeout(timer);reject(Error('Synthetic roadmap fixture exited: '+code));});
  server.stdout.on('data',chunk=>{text+=String(chunk);const match=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);accept(match[0]);}});
 });
 const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
 t.after(()=>browser.close());
 await mkdir(join(source,'.review-results'),{recursive:true});
 for(const width of [360,390,430,1365])for(const theme of ['light','dark'] as const){
  const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme,timezoneId:'Asia/Shanghai'});
  let writes=0;
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!==origin)return route.abort();
   if(!['GET','HEAD'].includes(request.method())){writes++;return route.fulfill({status:405});}
   if(url.pathname==='/api/platform/personal/status')return route.fulfill({json:{scope:'personal-manual-candidate',ownerId:'synthetic-owner',spaceId:'synthetic-space',storageVerified:true,writable:true,allowedTypes:['todo','journal','domain','project','topic']}});
   if(url.pathname==='/api/platform/personal/availability')return route.fulfill({json:{configured:true,loginAllowed:true,transport:'ssh-loopback',origin}});
   if(url.pathname==='/api/platform/personal/overview')return route.fulfill({json:{scope:'full-current-snapshot',total:items.length,truncated:false,items,today:url.searchParams.get('today'),observedAt:'2030-11-02T00:00:00Z'}});
   return route.continue();
  });
  await page.goto(origin+'/personal?page=tasks',{waitUntil:'domcontentloaded',timeout:55000});
  await expect(page.getByRole('heading',{level:1,name:'待办',exact:true})).toBeVisible();
  await expect(page.locator('[data-task-grid="reui"]').getByText('合成待办甲',{exact:true})).toBeVisible();
  if(width<850)await page.getByRole('button',{name:'打开导航',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'主导航',exact:true}).getByRole('button')).toHaveText(['总览','事项','需求池']);
  if(width<850)await page.getByRole('button',{name:'关闭导航',exact:true}).click();
  const sections=page.getByRole('navigation',{name:'待办分类视图'});
  await expect(page.getByText('管理项目与领域',{exact:true})).toHaveCount(0);
  await sections.getByRole('button',{name:'项目分类视图',exact:true}).click();
  await expect(page).toHaveURL(origin+'/personal?page=projects');
  const projects=page.locator('[data-category-grid="reui"]');
  await expect(projects.getByText('合成项目甲',{exact:true})).toBeVisible();
  await readyHeading(page,'项目');
  await categoryHeaderPresentation(page);
  await expect(projects.getByRole('link',{name:'编辑项目：合成项目甲'})).toHaveAttribute('href','/personal/edit?type=project&id='+ids[2]);
  await page.getByLabel('搜索项目',{exact:true}).fill('合成项目乙');
  await expect(projects.getByText('合成项目甲',{exact:true})).toHaveCount(0);
  await expect(projects.getByText('合成项目乙',{exact:true})).toBeVisible();
  await page.getByLabel('搜索项目',{exact:true}).fill('');
  await page.getByRole('combobox',{name:/^领域/}).selectOption(ids[0]);
  await expect(projects.getByText('合成项目乙',{exact:true})).toHaveCount(0);
  await page.getByRole('combobox',{name:/^领域/}).selectOption('');
  await page.screenshot({path:join(source,`.review-results/workspace-projects-${width}-${theme}.png`)});
  await projects.getByRole('button',{name:'查看待办：合成项目甲'}).click();
  await expect(page).toHaveURL(origin+'/personal?page=tasks');
  await expect(page.locator('[data-task-grid="reui"]').getByText('合成待办甲',{exact:true})).toBeVisible();
  await expect(page.locator('[data-task-grid="reui"]').getByText('合成待办乙',{exact:true})).toHaveCount(0);
  await sections.getByRole('button',{name:'领域分类视图',exact:true}).click();
  await expect(page.locator('[data-category-grid="reui"]').getByText('合成领域甲',{exact:true})).toBeVisible();
  await readyHeading(page,'领域');
  await categoryHeaderPresentation(page);
  const nav=async(name:string)=>{
   if(width<850)await page.getByRole('button',{name:'打开导航',exact:true}).click();
   await page.getByRole('button',{name,exact:true}).click();
  };
  await nav('设置');
  const settings=page.getByRole('dialog',{name:'设置',exact:true});
  await settings.getByRole('button',{name:'管理主题',exact:true}).click();
  const topics=settings.getByRole('region',{name:'管理主题',exact:true});
  await expect(topics.getByText('合成主题',{exact:true})).toBeVisible();
  await expect(topics.getByRole('link',{name:'编辑主题',exact:true})).toHaveAttribute('href','/personal/edit?type=topic&id='+ids[6]);
  await page.keyboard.press('Escape');await expect(settings).toHaveCount(0);
  await nav('设置');await expect(settings).toBeVisible();
  await settings.getByRole('button',{name:'关闭',exact:true}).click();await expect(settings).toHaveCount(0);
  await nav('需求池');
  await expect(page).toHaveURL(origin+'/personal?page=requirements');
  await expect(page.getByRole('heading',{level:1,name:'需求池',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'新建待办',exact:true})).toHaveCount(0);
  await expect(page.getByText('LO-TASK-001',{exact:true})).toBeVisible();
  await page.getByLabel('搜索需求',{exact:true}).fill('LO-TASK-001');
  await expect(page.getByText('LO-TASK-001',{exact:true})).toBeVisible();
  await expect(page.getByText('LO-FIN-001',{exact:true})).toHaveCount(0);
  const requirement=page.locator('[data-requirement-id="LO-TASK-001"]');
  const typography=await requirement.evaluate(element=>({body:parseFloat(getComputedStyle(element.querySelector('button')!).fontSize),id:parseFloat(getComputedStyle(element.querySelector('button span')!).fontSize)}));
  assert.ok(typography.body>=16&&typography.id>=14,'requirement title and metadata retain readable size');
  assert.ok(await page.getByLabel('搜索需求',{exact:true}).evaluate(element=>parseFloat(getComputedStyle(element).fontSize)>=16));
  await requirement.locator('button').first().click();
  const detail=page.getByRole('dialog');await expect(detail.getByRole('heading',{name:'验收条件',exact:true})).toBeVisible();
  await page.screenshot({path:join(source,`.review-results/workspace-requirement-detail-${width}-${theme}.png`)});
  await page.keyboard.press('Escape');await expect(detail).toHaveCount(0);
  await page.getByLabel('搜索需求',{exact:true}).fill('');
  await page.locator('#personal-main').evaluate(element=>element.scrollTo({top:0}));
  await page.screenshot({path:join(source,`.review-results/workspace-requirements-${width}-${theme}.png`)});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}/${theme} must contain horizontal table scrolling`);
  await page.reload({waitUntil:'domcontentloaded'});
  await expect(page.getByRole('heading',{level:1,name:'需求池',exact:true})).toBeVisible();
  assert.equal(writes,0,'browsing, sorting and filtering must not write business records');
  await page.close();
 }
});
