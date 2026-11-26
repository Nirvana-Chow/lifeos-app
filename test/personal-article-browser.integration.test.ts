import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test,{type TestContext} from 'node:test';
import {chromium,expect,type Browser,type Page} from '@playwright/test';
import {createPersonalPlatformHandler} from '../src/personal-candidate/runtime-http.ts';
import {MemoryPort} from './helpers/platform.ts';

const source=resolve(import.meta.dirname,'..');
const browserGate=process.env.RUN_PERSONAL_ARTICLE_BROWSER_TEST!=='1'&&'Requires disposable Next fixture and Chromium';

async function startArticleFixture(t:TestContext,articleEnabled:boolean){
  const relative=join('app','personal','articles','page.tsx');
  const routeSource=await readFile(join(source,relative),'utf8');
  const root=await mkdtemp(join(tmpdir(),'lifeos-article-browser-'));
  let dispose=async()=>{};
  t.after(async()=>{try{await dispose();}finally{await rm(root,{recursive:true,force:true});}});
  await mkdir(join(root,'app','personal','articles'),{recursive:true});
  await Promise.all([
    ...['layout.tsx','globals.css','theme.css'].map(name=>cp(join(source,'app',name),join(root,'app',name))),
    cp(join(source,'postcss.config.mjs'),join(root,'postcss.config.mjs')),
    cp(join(source,'src'),join(root,'src'),{recursive:true}),
    symlink(join(source,'components'),join(root,'components')),
    symlink(join(source,'node_modules'),join(root,'node_modules')),
  ]);
  const principalImport="import {readPlatformPagePrincipal} from '../../../src/platform/runtime';";
  assert.ok(routeSource.includes(principalImport));
  await writeFile(join(root,relative),routeSource.replace(principalImport,
    "const readPlatformPagePrincipal=async (headers: Pick<Headers,'get'>)=>headers.get('x-fixture-owner')==='confirmed'?{}:null;",
  ));
  const server=spawn(process.execPath,[join(source,'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','0'],{
    cwd:root,env:{
      PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',
      LIFEOS_PLATFORM_CANDIDATE:'1',LIFEOS_PLATFORM_TARGET:'isolated-test',
      LIFEOS_PLATFORM_TRANSPORT:'https-origin',LIFEOS_PLATFORM_BASE_URL:'https://article.example.test',
      LIFEOS_PLATFORM_HTTPS_HOST:'article.example.test',LIFEOS_PLATFORM_OWNER_ID:'article-browser-owner',
      LIFEOS_PLATFORM_OWNER_EMAIL:'article@example.test',LIFEOS_PLATFORM_SECRET:'synthetic-article-fixture-secret-never-live',
      LIFEOS_PLATFORM_TEST_DATABASE_URL:'postgres://lifeos_platform_candidate_runtime:unused@127.0.0.1:55432/lifeos_platform_test_local',
      LIFEOS_PERSONAL_ENABLED:'1',LIFEOS_PERSONAL_APPROVED:'personal-manual-v1',
      LIFEOS_PERSONAL_OWNER_ID:'article-browser-owner',LIFEOS_PERSONAL_OWNER_EMAIL:'article@example.test',
      LIFEOS_PERSONAL_SPACE_ID:'article-browser-space',LIFEOS_PERSONAL_DATABASE_NAME:'lifeos_platform_test_local',
      LIFEOS_PERSONAL_ALLOWED_TYPES:'todo,journal',
      ...(articleEnabled?{LIFEOS_PERSONAL_ARTICLE:'personal-article-v1'}:{}),
    },stdio:['ignore','pipe','pipe'],
  });
  const stopped=once(server,'exit');
  let browser:Browser|undefined;
  dispose=async()=>{
    try{await browser?.close();}finally{
      if(server.exitCode===null)server.kill('SIGTERM');
      const force=setTimeout(()=>server.kill('SIGKILL'),5000);
      try{await stopped;}finally{clearTimeout(force);}
    }
  };
  const origin=await new Promise<string>((accept,reject)=>{
    let output='';
    const timer=setTimeout(()=>reject(Error('Article browser fixture did not start')),30_000);
    server.once('exit',()=>{clearTimeout(timer);reject(Error('Article browser fixture exited'));});
    server.stdout.on('data',chunk=>{
      output+=String(chunk);
      const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if(match){clearTimeout(timer);accept(match[0]);}
    });
  });
  const anonymous=await fetch(origin+'/personal/articles',{redirect:'manual'});
  assert.equal(anonymous.status,307);
  assert.equal(anonymous.headers.get('location'),'/login');

  browser=await chromium.launch({executablePath:process.env.LIFEOS_TEST_CHROMIUM_PATH});
  for(const headers of [{},{'x-fixture-owner':'foreign'}] as Record<string,string>[]){
    const denied=await browser.newPage({extraHTTPHeaders:headers});
    await denied.goto(origin+'/personal/articles',{waitUntil:'domcontentloaded'});
    await expect(denied).toHaveURL(origin+'/login');
    await denied.close();
  }
  return {origin,browser};
}

test('OPT-IN disabled native Article retains the legacy tabs and local preview', {
  skip:browserGate,timeout:150_000,
},async t=>{
  const {origin,browser}=await startArticleFixture(t,false);
  const page=await browser.newPage({viewport:{width:1280,height:860},extraHTTPHeaders:{'x-fixture-owner':'confirmed'}});
  const writes:string[]=[];
  const nativeReads:string[]=[];
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==origin)return route.abort();
    if(url.pathname==='/api/platform/auth/get-session')return route.fulfill({json:{
      session:{mfaVerified:true,sessionDurationMode:'fixed',sessionDurationSeconds:3600,
        expiresAt:new Date(Date.now()+3600000).toISOString()},
    }});
    if(url.pathname.startsWith('/api/platform/personal/article'))nativeReads.push(url.pathname);
    if(!['GET','HEAD'].includes(request.method()))writes.push(request.method()+' '+url.pathname);
    return route.continue();
  });
  await page.goto(origin+'/personal/articles',{waitUntil:'domcontentloaded'});
  const resources=page.getByRole('button',{name:'阅读资料',exact:true});
  const articles=page.getByRole('button',{name:'文章',exact:true});
  const resourceHeading=page.getByRole('heading',{name:'阅读资料列表'});
  await expect(async()=>{
    await resources.click({timeout:2000});
    await expect(resourceHeading).toBeVisible({timeout:1000});
  }).toPass({timeout:15000});
  await articles.click();
  const article=page.getByRole('form',{name:'文章未保存草稿'});
  const title=article.getByLabel('草稿：标题',{exact:true});
  const body=article.getByLabel('草稿：正文 / 原文',{exact:true});
  await title.fill('合成旧草稿');
  await body.fill('未保存的原正文');
  await article.getByLabel('草稿：内容归属',{exact:true}).selectOption({label:'原创'});
  await resources.click();
  await expect(resourceHeading).toBeVisible();
  await articles.click();
  await expect(title).toHaveValue('合成旧草稿');
  await expect(body).toHaveValue('未保存的原正文');
  await article.getByRole('button',{name:'预览草稿'}).click();
  await expect(article).toContainText('未保存的原正文');
  await article.getByRole('button',{name:'继续编辑'}).click();
  await expect(body).toHaveValue('未保存的原正文');
  await expect(article.getByRole('button',{name:'保存 · 未接入'})).toBeDisabled();
  await article.getByRole('button',{name:'取消草稿'}).click();
  await expect(title).toHaveValue('');
  await expect(page.getByRole('status').filter({hasText:'草稿已取消，没有保存'})).toBeVisible();
  assert.deepEqual(nativeReads,[]);
  assert.deepEqual(writes,[]);
  const stored=await page.evaluate(()=>[...Object.values(localStorage),...Object.values(sessionStorage)].join('\n'));
  assert.doesNotMatch(stored,/合成旧草稿|未保存的原正文/);
});

test('OPT-IN native Article route reads, saves, recovers and edits private articles', {
  skip:browserGate,timeout:150_000,
},async t=>{
  const {origin,browser}=await startArticleFixture(t,true);
  const page=await browser.newPage({viewport:{width:390,height:860},colorScheme:'dark',extraHTTPHeaders:{'x-fixture-owner':'confirmed'}});
  const config={ownerId:'article-browser-owner',ownerEmail:'article@example.invalid',spaceId:'article-browser-space',databaseName:'lifeos_platform_test_local',allowedTypes:['todo','journal'],approval:'personal-manual-v1',baseURL:origin,articleEnabled:true} as const;
  const repo=new MemoryPort();
  repo.readCurrentSnapshot=async owner=>structuredClone([...repo.rows.values()].filter(row=>row.ownerId===owner));
  let mainSessionActive=true;
  const handler=createPersonalPlatformHandler({
    repository:repo,config,storageVerified:true,assertWritable:async()=>{},
    sessions:{read:async headers=>!mainSessionActive&&headers.get('x-fixture-client')==='main'?null:{userId:config.ownerId,email:config.ownerEmail}},
  });

  const writes:{key:string|null;body:string|null}[]=[];
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  let dropResponse=true;
  const mount=(client:Page,identity:string)=>client.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin!==origin)return route.abort();
    if(url.pathname==='/api/platform/status')return route.fulfill({status:200,json:{}});
    if(!url.pathname.startsWith('/api/platform/personal/'))return route.continue();
    const headers=new Headers(req.headers());
    headers.set('host',url.host);
    headers.set('x-fixture-client',identity);
    const input=req.postData();
    const response=await handler(new Request(url,{method:req.method(),headers,...(input?{body:input}:{})}));
    if(req.method()==='POST'||req.method()==='PATCH'){
      writes.push({key:headers.get('idempotency-key'),body:input});
      if(dropResponse&&response.status===201){dropResponse=false;return route.abort();}
    }
    return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
  });
  await mount(page,'main');
  await page.goto(origin+'/personal/articles',{waitUntil:'domcontentloaded'});
  const create=page.getByRole('button',{name:'新建文章',exact:true});
  await expect(page.getByRole('button',{name:'阅读资料',exact:true})).toHaveCount(0);
  await create.click();
  await page.getByRole('button',{name:'取消',exact:true}).click();
  assert.equal(writes.length,0);
  await create.click();
  await page.getByLabel('标题',{exact:true}).fill('合成文章');
  const body='第一段。\n\n第二段含 <script>literal</script>';
  await page.getByLabel('正文',{exact:true}).fill(body);
  await page.getByRole('button',{name:'保存文章',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('至少填写作者或原文链接');
  assert.equal(writes.length,0);
  await page.getByLabel('作者',{exact:true}).fill('合成作者');
  await page.getByRole('button',{name:'保存文章',exact:true}).click();
  await expect(page.getByRole('button',{name:'重试原保存请求'})).toBeVisible();
  assert.equal(repo.rows.size,1);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'重试原保存请求'}).click();
  await expect(page.getByRole('status').filter({hasText:'文章已保存'})).toBeVisible();
  assert.deepEqual(writes[0],writes[1]);
  assert.equal(repo.rows.size,1);

  await page.getByRole('button',{name:'合成文章',exact:true}).click();
  await expect(page.getByRole('article',{name:'合成文章'})).toContainText('第二段含 <script>literal</script>');
  await expect(page.getByRole('article',{name:'合成文章'})).toContainText('合成作者');
  await page.getByRole('button',{name:'编辑文章',exact:true}).click();
  await page.getByLabel('正文',{exact:true}).fill('第二版。');
  await page.getByLabel('原文链接',{exact:true}).fill('https://source.example.invalid/article');
  await page.getByRole('button',{name:'保存文章',exact:true}).click();
  await expect(page.getByRole('article',{name:'合成文章'})).toContainText('第二版。');
  await expect(page.getByRole('link',{name:'打开原文'})).toHaveAttribute('href','https://source.example.invalid/article');
  await page.getByText('版本历史',{exact:true}).click();
  await page.getByRole('button',{name:'版本 1',exact:true}).click();
  await expect(page.getByRole('article',{name:'合成文章'})).toContainText('第一段。');
  const other=await browser.newPage({viewport:{width:1280,height:860},extraHTTPHeaders:{'x-fixture-owner':'confirmed'}});
  await mount(other,'second');
  await other.goto(origin+'/personal/articles',{waitUntil:'domcontentloaded'});
  await other.getByRole('button',{name:'合成文章',exact:true}).click();
  await other.getByRole('button',{name:'编辑文章',exact:true}).click();
  await page.getByRole('button',{name:'编辑文章',exact:true}).click();
  await page.getByLabel('正文',{exact:true}).fill('本页保留的草稿');
  await other.getByLabel('正文',{exact:true}).fill('另一窗口先保存的正文');
  await other.getByRole('button',{name:'保存文章',exact:true}).click();
  await expect(other.getByRole('article',{name:'合成文章'})).toContainText('另一窗口先保存的正文');
  await page.getByRole('button',{name:'保存文章',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('版本冲突');
  await expect(page.getByLabel('正文',{exact:true})).toHaveValue('本页保留的草稿');
  await expect(page.getByRole('button',{name:'保存文章',exact:true})).toBeDisabled();
  assert.equal(repo.historyRows.length,3);

  mainSessionActive=false;
  await page.getByRole('button',{name:'读取最新版本',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'本人会话已失效'})).toBeVisible();
  await expect(page.getByLabel('正文',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('article',{name:'合成文章'})).toHaveCount(0);
  assert.equal(repo.historyRows.length,3);

  mainSessionActive=true;
  await page.getByRole('button',{name:'重新核对',exact:true}).click();
  await expect(page.getByLabel('正文',{exact:true})).toHaveValue('本页保留的草稿');
  await page.getByRole('button',{name:'读取最新版本',exact:true}).click();
  const comparison=page.getByRole('region',{name:'最新保存版本'});
  await expect(comparison).toContainText('另一窗口先保存的正文');
  await expect(page.getByLabel('正文',{exact:true})).toHaveValue('本页保留的草稿');
  await expect(page.getByRole('button',{name:'保存文章',exact:true})).toBeDisabled();
  const writesBeforeConfirm=writes.length;
  await page.getByRole('button',{name:'确认以版本 3 继续编辑',exact:true}).click();
  assert.equal(writes.length,writesBeforeConfirm);
  await page.getByRole('button',{name:'保存文章',exact:true}).click();
  await expect(page.getByRole('article',{name:'合成文章'})).toContainText('本页保留的草稿');
  assert.equal(JSON.parse(writes.at(-1)?.body??'{}').expectedRevision,3);
  assert.equal(repo.historyRows.length,4);
  assert.equal(repo.receipts.size,4);
  assert.deepEqual(errors,[]);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});
