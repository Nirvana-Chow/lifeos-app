import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {once} from 'node:events';
import {gunzipSync} from 'node:zlib';
import test from 'node:test';
import {chromium, expect} from '@playwright/test';

const keyEndpoint = '/api/platform/account/api-keys';
const syntheticKey = 'fixture-only-lifeos-agent-key-not-a-real-token';
const source = resolve(import.meta.dirname, '..');

async function startFixture(root: string) {
  await mkdir(join(root, 'app/account/api-keys'), {recursive:true});
  await mkdir(join(root, 'app/account/password'), {recursive:true});
  await mkdir(join(root, 'app/personal/edit'), {recursive:true});
  await mkdir(join(root, 'app/login'), {recursive:true});
  await mkdir(join(root, 'app/api/platform'), {recursive:true});
  await mkdir(join(root, 'test/helpers'), {recursive:true});
  await Promise.all([
    cp(join(source, 'app/layout.tsx'), join(root, 'app/layout.tsx')),
    cp(join(source, 'app/globals.css'), join(root, 'app/globals.css')),
    cp(join(source, 'app/theme.css'), join(root, 'app/theme.css')),
    cp(join(source, 'postcss.config.mjs'), join(root, 'postcss.config.mjs')),
    symlink(join(source, 'node_modules'), join(root, 'node_modules')),
    cp(join(source, 'src'), join(root, 'src'), {recursive:true}),
    symlink(join(source, 'components'), join(root, 'components')),
    cp(join(source, 'app/account/api-keys/page.tsx'), join(root, 'app/account/api-keys/page.tsx')),
    cp(join(source, 'app/personal/edit/page.tsx'), join(root, 'app/personal/edit/page.tsx')),
    cp(join(source, 'test/helpers/platform.ts'), join(root, 'test/helpers/platform.ts')),
    cp(join(source, 'app/account/password/page.tsx'), join(root, 'app/account/password/page.tsx')),
    cp(join(source, 'app/api/platform'), join(root, 'app/api/platform'), {recursive:true}),
    writeFile(join(root, 'app/personal/page.tsx'), `import {LivePersonalWorkspace} from '../../src/personal-candidate/live-workspace';
import {readWorkspaceLocation} from '../../src/workbench/private-navigation';
export default async function Page({searchParams}:{searchParams:Promise<{page?:string;modal?:string;panel?:string}>}){const location=readWorkspaceLocation(await searchParams);return <LivePersonalWorkspace initialPage={location.page} initialModal={location.modal} initialSettingsPanel={location.panel} showApiKeys/>;}\n`),
    writeFile(join(root, 'app/login/page.tsx'), `export default function Page(){return <main><h1>合成登录</h1></main>;}\n`),
  ]);
  // Actual account route modules keep their server gates. The disposable
  // runtime supplies a fixed synthetic owner to those checks.
  await writeFile(join(root,'src/platform/runtime.ts'), `import {MemoryPort} from '../../test/helpers/platform';
import {PersonalService} from '../personal-candidate/service';
import {handlePersonalRequest} from '../personal-candidate/http';
const repository=new MemoryPort();
repository.readCurrentSnapshot=async owner=>structuredClone([...repository.rows.values()].filter(row=>row.ownerId===owner));
const ownerId='synthetic-account-owner',spaceId='synthetic-account-space';
const allowedTypes=['todo','journal','project','domain','topic'] as const;
export const readPlatformPagePrincipal=async()=>({id:'synthetic-account-owner'});
export const readPlatformPasswordCapability=async()=>true;
export const readPlatformMfaState=async()=>({kind:'ready'});
export const handlePlatformRequest=async(request:Request)=>{
 const url=new URL(request.url),host=request.headers.get('host');
 if(!host||!/^127[.]0[.]0[.]1:[0-9]+$/.test(host))return Response.json({error:{code:'SYNTHETIC_HOST_REJECTED'}},{status:403});
 const origin='http://'+host;
 if(url.pathname==='/api/platform/personal/status')return Response.json({scope:'personal-manual-candidate',ownerId,spaceId,storageVerified:true,writable:true,allowedTypes});
 if(url.pathname==='/api/platform/personal/availability')return Response.json({configured:true,loginAllowed:true,transport:'ssh-loopback',origin});
 const service=new PersonalService(repository,{ownerId,ownerEmail:'fixture@example.test',spaceId,databaseName:'synthetic-memory',baseURL:origin,approval:'personal-manual-v1',allowedTypes});
 try{return await handlePersonalRequest(request,ownerId,origin,service,{assertOwner:async()=>{},assertWritable:async()=>{}})??Response.json({error:{code:'PLATFORM_UNAVAILABLE'}},{status:503});}
 catch(error){return Response.json({error:{code:'SYNTHETIC_REQUEST_REJECTED'}},{status:typeof error==='object'&&error&&'status'in error?Number(error.status):500});}
};\n`);
  return spawn(process.execPath, [join(source, 'node_modules/next/dist/bin/next'), 'dev', '--webpack',
    '--hostname', '127.0.0.1', '--port', '0'], {
    cwd: root,
    env: {PATH: process.env.PATH, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1'},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('OPT-IN API dialogs preserve one-time secrets, expiry, focus, uncertain results and pagination', {
  skip: process.env.RUN_AGENT_KEY_BROWSER_TESTS !== '1' && 'Requires local Chromium and a synthetic Next.js fixture',
  timeout: 150_000,
}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'lifeos-agent-key-browser-'));
  const fixture = await startFixture(root).catch(async error => {
    await rm(root, {recursive: true, force: true});
    throw error;
  });
  const stopped = once(fixture, 'exit');
  t.after(async () => {
    fixture.kill('SIGTERM');
    await stopped;
    await rm(root, {recursive: true, force: true});
  });

  let output = '';
  const origin = await new Promise<string>((accept, reject) => {
    const timer = setTimeout(() => reject(Error('Synthetic key UI fixture did not start')), 30_000);
    fixture.once('exit', code => {clearTimeout(timer); reject(Error('Synthetic key UI fixture exited: ' + code));});
    fixture.stdout.on('data', data => {
      output += String(data);
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {clearTimeout(timer); accept(match[0]);}
    });
  });
  const browser = await chromium.launch({executablePath: process.env.LIFEOS_TEST_CHROMIUM_PATH});
  t.after(() => browser.close());

  // Exercise real Next routing alongside the actual optional catch-all module.
  // A missing exact route would return the catch-all's closed 503 response;
  // unsupported methods must stop at the exact route with 405 instead.
  const transport = await browser.newContext();
  for (const method of ['GET','HEAD']) {
    const response=await transport.request.fetch(origin+'/api/platform/agent-skill',{method});
    assert.equal(response.status(),200,method+' exact artifact must precede private catch-all');
    assert.equal(response.headers()['content-type'],'application/gzip');
    assert.equal(response.headers()['set-cookie'],undefined);
    if (method==='HEAD') assert.equal((await response.body()).length,0);
    else assert.ok(gunzipSync(await response.body()).includes(Buffer.from('lifeos-agent/SKILL.md')));
  }
  const unsupported=await transport.request.post(origin+'/api/platform/agent-skill',{data:{}});
  assert.equal(unsupported.status(),405,'POST must not fall through to the private catch-all');
  for (const path of ['/api/platform/agent-skill/unknown','/api/platform/status']) {
    const response=await transport.request.get(origin+path);
    assert.equal(response.status(),503,'only the exact public artifact bypasses the closed private runtime');
    assert.equal((await response.json()).error.code,'PLATFORM_UNAVAILABLE');
  }
  assert.equal((await transport.request.get(origin+'/api/agent-skill')).status(),404,'removed alias is not exposed');
  const availability=await transport.request.get(origin+'/api/platform/personal/availability');
  assert.equal(availability.status(),200);
  assert.equal((await availability.json()).origin,origin,'synthetic server origin matches actual listener');
  const overview=await transport.request.get(origin+'/api/platform/personal/overview?today=2030-01-01');
  assert.equal(overview.status(),200,await overview.text());
  await transport.close();

  for (const theme of ['light','dark'] as const) for (const width of [360, 1365]) {
    const page = await browser.newPage({viewport: {width, height: 900}, timezoneId: 'Asia/Shanghai',colorScheme:theme});
    await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{(window as unknown as {copied:string}).copied=value;}}}));
    const grants: {id: string; name: string; scopes: string[]; createdAt: string; expiresAt: string; status: string; grantDigest?: string}[] = [];
    const posts: unknown[] = [];
    const patches: {expectedGrantDigest:string; scopes:string[]}[] = [];
    let scopeSupport=false;
    let scopePageTwo=false;
    let holdPatch=false;
    let releasePatch:(()=>void)|undefined;
    let patchMode:'ok'|'conflict'|'unknown'='ok';
    const availableScopes=['todo:read','todo:write','organization:read','organization:write'];
    let deletes = 0;
    let pageAttempts = 0;
    let personalReads = 0;
    let failReadback = false;
    let unknownResponse = false;
    let releasePost: (()=>void) | undefined;
    let holdPost = false;
    const cursor = 'fixture/older+keys';
    const olderGrant = {id: 'fixture-older-key', name: 'Synthetic older key', scopes: ['todo:read'],
      status: 'active', createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString()};
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      const path = url.pathname;
      if(request.method()==='DELETE'&&(path===keyEndpoint||path.startsWith(keyEndpoint+'/')))deletes++;
      if(path==='/api/platform/status')return route.fulfill({json:{authenticated:true}});
      if(path.startsWith('/api/platform/personal/')){
        personalReads++;
        if(path==='/api/platform/personal/status')return route.fulfill({json:{scope:'personal-manual-candidate',ownerId:'synthetic-account-owner',spaceId:'synthetic-account-space',storageVerified:true,writable:true,allowedTypes:['todo','journal','project','domain','topic']}});
        if(path==='/api/platform/personal/availability')return route.fulfill({json:{configured:true,loginAllowed:true,transport:'ssh-loopback',origin}});
        if(path==='/api/platform/personal/overview')return route.fulfill({json:{scope:'full-current-snapshot',truncated:false,total:0,items:[],today:url.searchParams.get('today'),observedAt:'2030-11-02T12:00:00.000Z'}});
        throw Error('Unexpected synthetic account request');
      }
      if (path === keyEndpoint && request.method() === 'GET') {
        if (failReadback) return route.fulfill({status:503});
        if (!url.search) return route.fulfill({json: {keys: scopePageTwo?grants.slice(0,1):grants, availableScopes:scopeSupport?availableScopes:undefined, nextCursor: grants.length ? cursor : undefined}});
        if (url.searchParams.get('cursor') !== cursor) return route.fulfill({status: 400});
        if(scopePageTwo)return route.fulfill({json:{keys:[grants[1],olderGrant],availableScopes}});
        if (++pageAttempts === 1) return route.fulfill({status: 503});
        return route.fulfill({json: {keys: [grants[0], olderGrant]}});
      }
      if (path.endsWith('/scopes') && request.method()==='PATCH') {
        const body=request.postDataJSON(); patches.push(body);
        if(holdPatch)await new Promise<void>(resolve=>{releasePatch=resolve;});
        const grant=grants.find(item=>path===keyEndpoint+'/'+item.id+'/scopes')!;
        if(patchMode==='conflict') {
          grant.scopes=['todo:read']; grant.grantDigest='c'.repeat(64);
          return route.fulfill({status:409,json:{error:{code:'CONFLICT'}}});
        }
        grant.scopes=body.scopes; grant.grantDigest='d'.repeat(64);
        if(patchMode==='unknown')return route.fulfill({status:200,body:'invalid-json'});
        return route.fulfill({json:{grant}});
      }
      if (path === keyEndpoint && request.method() === 'POST') {
        const data = request.postDataJSON();
        posts.push(data);
        if (holdPost) await new Promise<void>(resolve=>{releasePost=resolve;});
        if (unknownResponse) return route.fulfill({status:201,body:'invalid-json'});
        const now = Date.now();
        const grant = {id: 'fixture-grant-' + (grants.length + 1), name: data.name, scopes: data.scopes, status: 'active',
          createdAt: new Date(now).toISOString(),
          expiresAt: data.expiresAt ?? new Date(now + data.expiresInDays * 86_400_000).toISOString()};
        grants.push(grant);
        return route.fulfill({status: 201, json: {key: syntheticKey, grant}});
      }
      if (path === keyEndpoint + '/fixture-grant-1' && request.method() === 'DELETE') {
        grants[0].status = 'revoked';
        return route.fulfill({status: 204});
      }
      if (path === keyEndpoint + '/' + olderGrant.id && request.method() === 'DELETE') {
        olderGrant.status = 'revoked';
        return route.fulfill({status: 204});
      }
      if (path.startsWith(keyEndpoint)) return route.fulfill({status: 404});
      return route.continue();
    });

    const keysURL=origin+'/personal?modal=settings&panel=api-keys';
    await page.goto(origin+'/account/api-keys', {waitUntil: 'domcontentloaded', timeout: 55_000});
    await expect(page.getByRole('dialog',{name:'设置',exact:true})).toBeVisible();
    await expect(page.getByRole('heading', {level:2,name: 'API 密钥',exact:true})).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-lifeos-theme',theme);
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('.lo-shell')).toHaveCount(1);
    await expect(page.locator('header [data-slot="theme-toggle"]')).toHaveCount(1);
    await expect(page.getByRole('link',{name:'修改密码',exact:true})).toHaveCount(0);
    await page.reload({waitUntil:'domcontentloaded'});
    await expect(page.getByText('还没有签发密钥。')).toBeVisible();
    const beforeAccountRead=personalReads;
    await expect(page.getByText('还没有签发密钥。')).toBeVisible();
    await expect(page.locator('[name="name"]')).toHaveCount(0);
    const newKey=page.getByRole('button',{name:'新建密钥',exact:true});
    await newKey.click();
    const createDialog=page.getByRole('dialog',{name:'新建密钥',exact:true});
    await expect(createDialog).toBeVisible();
    await expect(createDialog.locator('[name="name"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(createDialog).toHaveCount(0);
    await expect(newKey).toBeFocused();
    await newKey.click();
    await page.locator('[name="name"]').fill('Synthetic Skill');
    await page.locator('[name="permission"]').selectOption('write');
    await page.locator('[name="expiry"]').selectOption('custom');
    const customExpiry = page.locator('[name="custom-expiry"]');
    const controls = await page.locator('[name="name"], [name="permission"], [name="expiry"], [name="custom-expiry"]').evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      return {name: element.getAttribute('name'), height: box.height, width: box.width};
    }));
    await mkdir(join(source, '.review-results'), {recursive: true});
    await page.screenshot({path: join(source, `.review-results/api-key-${process.env.LIFEOS_KEY_SCREENSHOT_STAGE ?? 'current'}-${theme}-${width}.png`), fullPage: true});
    assert.ok(controls.every(control => Math.abs(control.height - 44) <= 1), JSON.stringify(controls));
    const formWidth = await page.locator('fieldset').evaluate(element => element.getBoundingClientRect().width);
    assert.ok(Math.abs(controls[3].width - formWidth) <= 1, 'custom date uses the full form row');
    await page.locator('[name="expiry"]').selectOption('30');
    await expect(page.getByText(/预计到期：.*Asia\/Shanghai/)).toBeVisible();
    await expect(page.getByText('实际到期时间以签发后服务端返回为准。')).toBeVisible();
    await page.screenshot({path: join(source, `.review-results/api-key-${process.env.LIFEOS_KEY_SCREENSHOT_STAGE ?? 'current'}-preset-${theme}-${width}.png`), fullPage: true});
    await page.locator('[name="expiry"]').selectOption('custom');
    await customExpiry.fill('2099-01-01T09:30');
    await page.getByRole('button', {name: '创建密钥'}).click();
    await expect(page.getByRole('status').filter({hasText: '365 天'})).toBeVisible();
    assert.equal(posts.length, 0);
    assert.equal(personalReads,beforeAccountRead,'opening key dialogs does not refetch background records');

    const date = await page.evaluate(() => {
      const local = new Date(Date.now() + 86_400_000);
      local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
      return local.toISOString().slice(0, 16);
    });
    await customExpiry.fill(date);
    holdPost=true;
    await page.getByRole('button', {name: '创建密钥'}).click();
    await expect.poll(()=>posts.length).toBe(1);
    await page.keyboard.press('Escape');
    await page.mouse.click(1,1);
    await expect(createDialog).toBeVisible();
    await expect(createDialog.getByRole('button',{name:'取消',exact:true})).toBeDisabled();
    assert.equal(posts.length,1,'pending cannot repeat issuance or lose its response');
    releasePost!();
    holdPost=false;
    const reveal = page.locator('code[aria-label="新密钥"]');
    await expect(reveal).toHaveText(syntheticKey);
    const revealDialog=page.getByRole('dialog',{name:'复制新密钥',exact:true});
    await expect(revealDialog).toBeVisible();
    await expect(revealDialog.getByRole('heading',{name:'复制新密钥'})).toBeFocused();
    await page.screenshot({path:join(source,`.review-results/api-key-reveal-${theme}-${width}.png`),fullPage:true});
    assert.deepEqual(posts, [{name: 'Synthetic Skill', scopes: ['todo:read', 'todo:write'],
      expiresAt: new Date(date + ':00+08:00').toISOString()}]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('blocked');}}}));
    await page.getByRole('button',{name:'复制密钥',exact:true}).click();
    await expect(revealDialog.getByRole('status')).toContainText('手动选中');
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(value:string)=>{(window as unknown as {copied:string}).copied=value;}}}));
    await page.getByRole('button',{name:'复制密钥',exact:true}).click();
    await expect(revealDialog.getByText('已复制',{exact:true})).toBeVisible();
    assert.equal(await page.evaluate(()=>(window as unknown as {copied:string}).copied),syntheticKey);
    await page.getByRole('button', {name: '关闭密钥'}).click();
    await expect(newKey).toBeFocused();
    await expect(reveal).toHaveCount(0);
    await page.reload({waitUntil: 'domcontentloaded'});
    await expect(page.getByText('Synthetic Skill', {exact: true})).toBeVisible();
    await expect(page.getByText(syntheticKey, {exact: true})).toHaveCount(0);

    await page.getByRole('button', {name: '替换 Synthetic Skill'}).click();
    await expect(page.getByRole('heading', {name: '创建替换密钥'})).toBeVisible();
    await expect(page.locator('[name="name"]')).toHaveValue('Synthetic Skill');
    await page.locator('[name="name"]').fill('Synthetic replacement');
    await page.locator('[name="expiry"]').selectOption('365');
    await page.getByRole('button', {name: '创建密钥'}).click();
    await expect(reveal).toHaveText(syntheticKey);
    assert.equal(posts.length, 2);
    assert.deepEqual(posts[1], {name: 'Synthetic replacement', scopes: ['todo:read', 'todo:write'], expiresInDays: 365});
    assert.equal(deletes, 0, 'replacement creation preserves the original grant');
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await expect(reveal).toHaveCount(0);
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow')));
    await expect(page.getByRole('button',{name:'替换 Synthetic Skill'})).toBeFocused();
    await page.goto(origin+'/login');
    await page.goBack({waitUntil:'domcontentloaded'});
    await expect(page).toHaveURL(keysURL);
    await expect(page.getByText(syntheticKey,{exact:true})).toHaveCount(0);
    await page.goForward({waitUntil:'domcontentloaded'});
    await page.goBack({waitUntil:'domcontentloaded'});
    await expect(reveal).toHaveCount(0);
    await page.getByRole('button', {name: '撤销 Synthetic Skill'}).click();
    const dialog = page.getByRole('dialog', {name: '撤销密钥'});
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', {name: '取消', exact: true}).click();
    await expect(dialog).toHaveCount(0);
    assert.equal(deletes, 0);
    await page.getByRole('button', {name: '撤销 Synthetic Skill'}).click();
    await dialog.getByRole('button', {name: '确认撤销'}).click();
    await expect(page.getByText('已撤销', {exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: '撤销 Synthetic Skill'})).toHaveCount(0);
    assert.equal(deletes, 1);
    await expect(page.getByRole('button', {name: '撤销 Synthetic replacement'})).toBeVisible();
    const loadMore = page.getByRole('button', {name: '加载更多密钥'});
    await loadMore.click();
    await expect(page.getByRole('status').filter({hasText: '暂时无法读取更多密钥'})).toBeVisible();
    await expect(page.getByRole('button', {name: '撤销 Synthetic replacement'})).toBeVisible();
    await loadMore.click();
    await expect(page.getByRole('button', {name: '撤销 Synthetic older key'})).toBeVisible();
    await expect(page.getByText('Synthetic Skill', {exact: true})).toHaveCount(1);
    await expect(loadMore).toHaveCount(0);
    await page.getByRole('button', {name: '撤销 Synthetic older key'}).click();
    await dialog.getByRole('button', {name: '确认撤销'}).click();
    await loadMore.click();
    const olderRow = page.getByRole('listitem').filter({hasText: 'Synthetic older key'});
    await expect(olderRow.getByText('已撤销', {exact: true})).toBeVisible();
    await newKey.click();
    await page.locator('[name="name"]').fill('Synthetic uncertain');
    unknownResponse=true;failReadback=true;
    const automaticReadback=page.waitForResponse(response=>{
      const url=new URL(response.url());
      return url.origin===origin && url.pathname===keyEndpoint && !url.search && response.request().method()==='GET';
    });
    await page.getByRole('button',{name:'创建密钥',exact:true}).click();
    await expect(createDialog.getByRole('status')).toContainText('创建结果未确认');
    await page.keyboard.press('Escape');
    await expect(createDialog).toBeVisible();
    await expect(createDialog.getByRole('button',{name:'创建密钥',exact:true})).toBeDisabled();
    assert.equal(posts.length,3,'unknown issuance waits for list readback before retry');
    assert.equal((await automaticReadback).status(),503);
    await expect(createDialog.getByRole('button',{name:'重新读取密钥列表',exact:true})).toBeEnabled();
    failReadback=false;
    await createDialog.getByRole('button',{name:'重新读取密钥列表',exact:true}).click();
    await expect(createDialog.getByRole('button',{name:'创建密钥',exact:true})).toBeEnabled();
    await createDialog.getByRole('button',{name:'取消',exact:true}).click();
    await expect(newKey).toBeFocused();
    await page.getByRole('button',{name:'复制安装说明',exact:true}).click();
    const instructions=await page.evaluate(()=>(window as unknown as {copied:string}).copied);
    assert.ok(instructions.includes(origin+'/api/platform/agent-skill'));
    assert.ok(!instructions.includes(syntheticKey));
    await expect(page.getByRole('link',{name:'下载 LifeOS Agent Skill',exact:true})).toHaveAttribute('href','/api/platform/agent-skill');
    const downloading=page.waitForEvent('download');
    await page.getByRole('link',{name:'下载 LifeOS Agent Skill',exact:true}).click();
    const download=await downloading;
    assert.equal(download.suggestedFilename(),'lifeos-agent.tar.gz');
    const archive=gunzipSync(await readFile((await download.path())!)).toString();
    assert.ok(archive.includes('lifeos-agent/SKILL.md'));
    assert.ok(archive.includes('references/operations.md'));
    assert.ok(!archive.includes(syntheticKey));
    // Legacy servers omit scope capabilities: preserve the original todo form and no edit control.
    await expect(page.getByRole('button',{name:'修改权限 Synthetic replacement'})).toHaveCount(0);
    scopeSupport=true; unknownResponse=false;
    const editable=grants[1]; editable.grantDigest='a'.repeat(64);
    await page.reload({waitUntil:'domcontentloaded'});
    await newKey.click();
    const moduleCreate=page.getByRole('dialog',{name:'新建密钥',exact:true});
    await expect(moduleCreate.getByLabel('读取待办',{exact:true})).toBeChecked();
    await moduleCreate.getByLabel('写入项目、领域和主题',{exact:true}).check();
    await expect(moduleCreate.getByLabel('读取项目、领域和主题',{exact:true})).toBeChecked();
    await moduleCreate.getByLabel('读取项目、领域和主题',{exact:true}).uncheck();
    await expect(moduleCreate.getByLabel('写入项目、领域和主题',{exact:true})).not.toBeChecked();
    await moduleCreate.getByRole('button',{name:'取消',exact:true}).click();
    const editButton=page.getByRole('button',{name:'修改权限 Synthetic replacement',exact:true});
    await editButton.click();
    const scopeDialog=page.getByRole('dialog',{name:'修改密钥权限',exact:true});
    await expect(scopeDialog.getByText('所有持有该密钥的客户端也会获得这些权限。',{exact:true})).toBeVisible();
    await expect(scopeDialog.getByLabel('读取待办',{exact:true})).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(scopeDialog.getByLabel('写入待办',{exact:true})).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(scopeDialog.getByLabel('读取待办',{exact:true})).toBeFocused();
    const permissionTargets=await scopeDialog.locator('fieldset label').evaluateAll(labels=>labels.map(label=>label.getBoundingClientRect().height));
    assert.ok(permissionTargets.every(height=>height>=44),'permission labels preserve 44px targets');
    await expect(scopeDialog.getByText('Synthetic replacement',{exact:true})).toBeVisible();
    await scopeDialog.getByLabel('写入项目、领域和主题',{exact:true}).check();
    await expect(scopeDialog.getByLabel('读取项目、领域和主题',{exact:true})).toBeChecked();
    await scopeDialog.getByRole('button',{name:'取消',exact:true}).click();
    assert.equal(patches.length,0);
    await expect(editButton).toBeFocused();
    await editButton.click();
    await scopeDialog.getByLabel('写入项目、领域和主题',{exact:true}).check();
    const originalExpiry=editable.expiresAt;
    await page.screenshot({path:join(source,`.review-results/api-key-scopes-${theme}-${width}.png`),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    holdPatch=true;
    await scopeDialog.getByRole('button',{name:'确认修改权限',exact:true}).click();
    await expect.poll(()=>patches.length).toBe(1);
    await page.keyboard.press('Escape'); await page.mouse.click(1,1);
    await expect(scopeDialog).toBeVisible();
    await expect(scopeDialog.getByRole('button',{name:'确认修改权限',exact:true})).toBeDisabled();
    await expect(scopeDialog.getByRole('button',{name:'取消',exact:true})).toBeDisabled();
    releasePatch!();holdPatch=false;
    await expect(scopeDialog).toHaveCount(0);
    assert.deepEqual(patches,[{expectedGrantDigest:'a'.repeat(64),scopes:availableScopes}]);
    assert.equal(editable.expiresAt,originalExpiry);
    assert.equal(posts.length,3,'scope changes do not issue a new key');
    patchMode='conflict';
    await editButton.click();
    await scopeDialog.getByLabel('写入待办',{exact:true}).uncheck();
    await scopeDialog.getByRole('button',{name:'确认修改权限',exact:true}).click();
    await expect(scopeDialog.getByRole('status')).toContainText('权限已变化');
    await expect(scopeDialog.getByText('当前权限：待办：仅读取',{exact:true})).toBeVisible();
    await expect(scopeDialog.getByLabel('写入项目、领域和主题',{exact:true})).toBeChecked();
    await expect(scopeDialog.getByLabel('写入待办',{exact:true})).not.toBeChecked();
    assert.equal(patches.length,2,'409 never automatically retries');
    patchMode='unknown'; failReadback=true;
    await scopeDialog.getByRole('button',{name:'确认修改权限',exact:true}).click();
    await expect(scopeDialog.getByRole('status')).toContainText('结果未确认');
    assert.deepEqual(patches[2],{expectedGrantDigest:'c'.repeat(64),scopes:['todo:read','organization:read','organization:write']});
    await page.keyboard.press('Escape'); await page.mouse.click(1,1);
    await expect(scopeDialog).toBeVisible();
    await expect(scopeDialog.getByRole('button',{name:'取消',exact:true})).toBeDisabled();
    await expect(scopeDialog.getByRole('button',{name:'确认修改权限',exact:true})).toBeDisabled();
    await expect(scopeDialog.getByLabel('写入项目、领域和主题',{exact:true})).toBeDisabled();
    await page.screenshot({path:join(source,`.review-results/api-key-scopes-unknown-${theme}-${width}.png`),fullPage:true});
    failReadback=false;
    // A differing readback cannot prove that the in-flight request did not commit.
    editable.scopes=['todo:read']; scopePageTwo=true;
    await scopeDialog.getByRole('button',{name:'重新读取当前权限',exact:true}).click();
    await expect(scopeDialog.getByRole('status')).toContainText('当前权限与本次请求不同');
    await expect(scopeDialog.getByRole('button',{name:'重新读取当前权限',exact:true})).toBeEnabled();
    await expect(scopeDialog.getByRole('button',{name:'取消',exact:true})).toBeDisabled();
    editable.scopes=[...patches[2].scopes];
    await scopeDialog.getByRole('button',{name:'重新读取当前权限',exact:true}).click();
    await expect(scopeDialog).toHaveCount(0);
    assert.equal(patches.length,3,'unknown readback never resends or changes the frozen request');
    scopePageTwo=false;
    assert.equal(editable.expiresAt,originalExpiry);
    assert.equal(posts.length,3);
    // Explicit creation can be organization-only; read is automatically included with write.
    await newKey.click();
    await moduleCreate.locator('[name="name"]').fill('Synthetic organization-only');
    await moduleCreate.getByLabel('读取待办',{exact:true}).uncheck();
    await moduleCreate.getByRole('button',{name:'创建密钥',exact:true}).click();
    await expect(moduleCreate.getByRole('status')).toHaveText('请至少选择一项读取权限。');
    assert.equal(posts.length,3,'empty permissions cannot send a create request');
    await moduleCreate.getByLabel('写入项目、领域和主题',{exact:true}).check();
    await moduleCreate.getByRole('button',{name:'创建密钥',exact:true}).click();
    await expect(reveal).toHaveText(syntheticKey);
    assert.deepEqual(posts[3],{name:'Synthetic organization-only',scopes:['organization:read','organization:write'],expiresInDays:30});
    await page.getByRole('button',{name:'关闭密钥',exact:true}).click();
    await expect(page.getByRole('button',{name:'修改权限 Synthetic organization-only',exact:true})).toHaveCount(0);
    const deletesBeforeOrganizationDialog=deletes;
    await page.getByRole('button',{name:'撤销 Synthetic organization-only',exact:true}).click();
    await expect(dialog.getByText('撤销「Synthetic organization-only」后，所有使用这把密钥的客户端将无法继续访问其授权的数据。',{exact:true})).toBeVisible();
    await dialog.getByRole('button',{name:'取消',exact:true}).click();
    assert.equal(deletes,deletesBeforeOrganizationDialog,'viewing organization-only revocation consent does not revoke');
    // Fixture-only negative probe: even a rejected DELETE for this target must be counted.
    const organizationGrant=grants.find(grant=>grant.name==='Synthetic organization-only')!;
    const rejectedDelete=await page.evaluate(async url=>(await fetch(url,{method:'DELETE'})).status,keyEndpoint+'/'+organizationGrant.id);
    assert.equal(rejectedDelete,404);
    assert.equal(deletes,deletesBeforeOrganizationDialog+1,'counter observes DELETE for the organization-only grant');
    await page.close();
  }
  // Actual Next route -> existing PersonalService writer -> memory storage port.
  // This proves website create/edit/readback wiring, separately from native PG/MFA qualification.
  for(const theme of ['light','dark'] as const) for(const width of [360,1365]) {
    const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme});
    for(const [type,label] of [['domain','领域'],['topic','主题'],['project','项目']] as const) {
      await page.goto(origin+'/personal/edit?type='+type,{waitUntil:'domcontentloaded'});
      await expect(page.getByRole('heading',{name:'新建'+label,exact:true})).toBeVisible();
      const title=`Synthetic ${type} ${theme} ${width}`;
      await page.getByLabel('标题',{exact:true}).fill(title);
      await page.getByLabel(type==='project'?'目标':'说明 / 正文',{exact:true}).fill('Synthetic organization description');
      await page.getByLabel('我已核对这一条内容，确认保存到本人空间。',{exact:true}).check();
      const created=page.waitForResponse(response=>response.url()===origin+'/api/platform/personal/'+type&&response.request().method()==='POST');
      await page.getByRole('button',{name:'确认保存',exact:true}).click();
      const response=await created;
      assert.equal(response.status(),201);
      const first=await response.json();
      assert.equal(first.entry.revision,1);
      assert.equal(first.entry.draft.title,title);
      await expect(page.getByRole('button',{name:title,exact:true})).toBeVisible();
      await page.getByLabel('标题',{exact:true}).fill(title+' edited');
      await page.getByLabel('我已核对这一条内容，确认保存到本人空间。',{exact:true}).check();
      const patched=page.waitForResponse(response=>response.url().endsWith('/'+first.entry.id)&&response.request().method()==='PATCH');
      await page.getByRole('button',{name:'确认保存',exact:true}).click();
      const edited=await patched;
      assert.equal(edited.status(),200);
      assert.equal((await edited.json()).entry.revision,2);
      await expect(page.getByRole('button',{name:title+' edited',exact:true})).toBeVisible();
      await page.goto(origin+'/personal/edit?type='+type+'&id='+first.entry.id,{waitUntil:'domcontentloaded'});
      await expect(page.getByLabel('标题',{exact:true})).toHaveValue(title+' edited');
      await expect(page.getByText('版本 2',{exact:true}).first()).toBeVisible();
      await page.getByRole('button',{name:'重新核对状态',exact:true}).click();
      await expect(page.getByRole('button',{name:title+' edited',exact:true})).toBeVisible();
      await page.screenshot({path:join(source,`.review-results/organization-${type}-${theme}-${width}.png`),fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      const read=await page.request.get(origin+'/api/platform/personal/'+type+'/'+first.entry.id);
      assert.equal(read.status(),200);
      const current=(await read.json()).entry;
      assert.equal(current.revision,2);assert.equal(current.source.id,first.entry.source.id);
      assert.equal(current.draft.title,title+' edited');
    }
    await page.route('**/api/platform/personal/status',route=>route.fulfill({status:503,json:{error:{code:'PLATFORM_UNAVAILABLE'}}}));
    await page.route('**/api/platform/personal/availability',route=>route.fulfill({json:{configured:false,loginAllowed:false}}));
    await page.goto(origin+'/personal/edit?type=project',{waitUntil:'domcontentloaded'});
    await expect(page.getByRole('heading',{name:'尚不能保存本人资料',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'确认保存',exact:true})).toHaveCount(0);
    await page.close();
  }

});
