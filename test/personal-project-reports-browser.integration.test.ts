import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {projectReports} from '../src/personal-reports/report.ts';
import {chromium,expect} from '@playwright/test';

const source=resolve(import.meta.dirname,'..');
const id=(n:number)=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0');
const ownerId='synthetic-report-owner',spaceId='synthetic-report-space';
const observedAt='2026-11-26T00:00:00Z';
function record(n:number,type:'project'|'todo',draft:object,revision=1){
  return {id:id(n),kind:type==='todo'?'todo':'inbox',draft,revision,createdAt:observedAt,
    updatedAt:observedAt,syncState:'draft',externalStatus:null,
    source:{id:id(n+100),externalId:id(n),system:'website',version:1,asOf:observedAt,
      original:{marker:'personal-manual-v1',spaceId,type,input:{}}}};
}
const project=(n:number)=>record(n,'project',{
  title:'Synthetic same-name project',text:'',occurredOn:null,disposition:'reference',
  personal:{type:'project',stage:'active',purpose:'advance',nextStep:'',domain:null,topics:[]},
});
const task=record(3,'todo',{title:'Synthetic attached task',notes:'',dueOn:null,status:'open',
  personal:{project:{id:id(1),sourceId:id(101),revision:1},domain:null,topics:[]}});

test('OPT-IN project review uses existing private route and read-only snapshot', {
  skip:process.env.RUN_PERSONAL_PROJECT_REPORTS_BROWSER_TESTS!=='1' && 'Requires isolated synthetic Next fixture and Chromium',
  timeout:180_000,
},async t=>{
  const root=await mkdtemp(join(tmpdir(),'lifeos-project-reports-browser-'));
  let stopServer: (()=>Promise<unknown>)|undefined,closeBrowser: (()=>Promise<void>)|undefined;
  t.after(async()=>{
    try{await closeBrowser?.();}
    finally{try{await stopServer?.();}finally{await rm(root,{recursive:true,force:true});}}
  });
  await mkdir(join(root,'app/personal/reports'),{recursive:true});
  const routePath='app/personal/reports/page.tsx';
  const route=await readFile(join(source,routePath),'utf8');
  const syntheticRoute=route.replace("from '../../../src/platform/runtime'","from '../../../src/reports-fixture-principal'");
  assert.notEqual(syntheticRoute,route);
  const workspacePath='app/personal/page.tsx';
  const workspace=await readFile(join(source,workspacePath),'utf8');
  const syntheticWorkspace=workspace.replace("from'../../src/platform/runtime'","from'../../src/reports-fixture-principal'");
  assert.notEqual(syntheticWorkspace,workspace);
  await Promise.all([
    ...['layout.tsx','globals.css','theme.css'].map(name=>cp(join(source,'app',name),join(root,'app',name))),
    cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
    cp(join(source,'src'),join(root,'src'),{recursive:true}),
    symlink(join(source,'node_modules'),join(root,'node_modules')),
    symlink(join(source,'components'),join(root,'components')),
    writeFile(join(root,routePath),syntheticRoute),
    writeFile(join(root,workspacePath),syntheticWorkspace),
  ]);
  await writeFile(join(root,'src/reports-fixture-principal.ts'),
    "export async function readPlatformPagePrincipal(){return {userId:'synthetic-report-owner'};} export async function readPlatformPasswordCapability(){return false;}");
  const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{
    cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe'],
  });
  const stopped=once(server,'exit');
  let output='';
  server.stderr.on('data',chunk=>{output+=String(chunk);});
  stopServer=async()=>{server.kill('SIGTERM');await stopped;};
  const origin=await new Promise<string>((accept,reject)=>{
    const timer=setTimeout(()=>reject(Error(output)),30000);
    server.once('exit',()=>{clearTimeout(timer);reject(Error(output));});
    server.stdout.on('data',chunk=>{
      output+=String(chunk);
      const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if(match){clearTimeout(timer);accept(match[0]);}
    });
  });
  const browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
  closeBrowser=()=>browser.close();
  for(const width of [1365,390]){
    const page=await browser.newPage({viewport:{width,height:900}});
    let entries=[project(1),project(2),task],truncated=false,denied=false;
    const writes:string[]=[];
    await page.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin!==origin)return route.abort();
      if(!url.pathname.startsWith('/api/'))return route.continue();
      if(request.method()!=='GET'){writes.push(request.method());return route.fulfill({status:405});}
      if(denied)return route.fulfill({status:401});
      const access={scope:'personal-manual-candidate',ownerId,spaceId,storageVerified:true,writable:false,allowedTypes:['project','todo']};
      if(url.pathname==='/api/platform/personal/status'||url.pathname==='/api/platform/status')return route.fulfill({json:access});
      if(url.pathname==='/api/platform/personal/todo/workspace-snapshot'){
        const today=url.searchParams.get('today')!;
        const snapshot={scope:'task-workspace-current-snapshot',items:entries,total:entries.length,today,observedAt,truncated};
        if(url.searchParams.get('view')==='project-reports')
          return route.fulfill({json:{...snapshot,items:[],total:0,review:truncated?null:projectReports(snapshot,spaceId,today)}});
        return route.fulfill({json:{...snapshot,access}});
      }
      const match=/^\/api\/platform\/personal\/project\/([^/]+)\/history$/.exec(url.pathname);
      const entry=match&&entries.find(row=>row.id===match[1]);
      if(entry)return route.fulfill({json:{scope:'project-review-evidence',projectId:entry.id,sourceId:entry.source.id,
        revision:entry.revision,historyCoverage:'partial',originalDecision:null}});
      return route.fulfill({status:404});
    });
    await page.goto(origin+'/personal?page=projects');
    const navigation=page.getByRole('link',{name:'项目回顾',exact:true});
    if(width===390){
      const menu=page.getByRole('button',{name:'打开导航',exact:true});
      if(await menu.isVisible())await menu.click();
    }
    await navigation.filter({visible:true}).first().click();
    const review=page.getByRole('region',{name:'项目回顾'});
    const refresh=review.getByRole('button',{name:'重新核对'});
    const taskLink=review.getByRole('link',{name:'Synthetic attached task'});
    await expect(taskLink).toHaveAttribute('href','/personal/edit?type=todo&id='+id(3));
    await expect(review.getByRole('link',{name:'Synthetic same-name project'})).toHaveAttribute('href','/personal/edit?type=project&id='+id(1));
    await review.getByRole('combobox').selectOption(id(2));
    await expect(taskLink).toHaveCount(0);
    await expect(page).toHaveURL(/project=/);
    await page.reload();
    await expect(review.getByRole('combobox')).toHaveValue(id(2));
    await expect(review.getByText(/历史读取受限/)).toBeVisible();
    await review.getByRole('combobox').selectOption(id(1));
    await expect(taskLink).toBeVisible();
    entries=[project(1),project(2),{...task,revision:2}];
    await refresh.click();
    await expect(review.getByText(/回顾待更新/)).toBeVisible();
    await review.getByRole('button',{name:'以当前快照更新回顾'}).click();
    await expect(review.getByText(/回顾待更新/)).toHaveCount(0);
    entries=[project(1),project(2)];
    await refresh.click();
    await expect(review.getByText(/回顾待更新/)).toBeVisible();
    await expect(taskLink).toHaveCount(0);
    truncated=true;
    await refresh.click();
    await expect(review.getByText(/无法核验完整/)).toBeVisible();
    await expect(review.getByRole('link',{name:'Synthetic same-name project'})).toHaveCount(0);
    await review.getByRole('link',{name:'返回项目'}).click();
    await expect(page).toHaveURL(/page=projects/);
    await page.goto(origin+'/personal/reports?project='+id(1));
    await expect(review.getByText(/无法核验完整/)).toBeVisible();
    truncated=false;denied=true;
    await refresh.click();
    await expect(review.getByText(/读取权限/)).toBeVisible();
    await expect(review.getByRole('combobox')).toHaveCount(0);
    assert.deepEqual(writes,[]);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await page.close();
  }
});
