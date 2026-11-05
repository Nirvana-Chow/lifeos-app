import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {trackAuthThemeProcess,cleanupAuthThemeFixture} from './helpers/auth-theme-fixture-lifecycle.ts';
const timings={browserMs:30,termMs:60,killMs:200};
const exists=(p:string)=>access(p).then(()=>true,()=>false);
async function fixture(script='setInterval(()=>{},1000)'){
 const root=await mkdtemp(join(tmpdir(),'lifeos-auth-theme-'));await writeFile(join(root,'sentinel'),'synthetic');
 const child=spawn(process.execPath,['-e',script],{stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'}),tracked=trackAuthThemeProcess(child,process.platform!=='win32');child.stdout.resume();child.stderr.resume();
 await once(child,'spawn');return{root,child,tracked};
}
async function emergency(f:Awaited<ReturnType<typeof fixture>>){if(!f.tracked.hasExited())f.child.kill('SIGKILL');await f.tracked.closed;await rm(f.root,{recursive:true,force:true});}
test('normal cleanup confirms process exit and closed pipes before removing its temporary root',async()=>{
 const f=await fixture();try{await cleanupAuthThemeFixture({root:f.root,server:f.tracked},timings);assert.equal(f.tracked.hasExited(),true);assert.equal(f.tracked.hasClosed(),true);assert.equal(await exists(f.root),false);}finally{await emergency(f);}
});
test('a hung browser close fails within its deadline but still terminates both real owned processes',async()=>{
 const server=await fixture(),browser=await fixture();let forced=false;
 try{await assert.rejects(cleanupAuthThemeFixture({root:server.root,server:server.tracked,browser:{close:()=>new Promise(()=>{})},browserServer:{close:async()=>{},kill:async()=>{forced=true;browser.child.kill('SIGKILL');await browser.tracked.closed;}},browserProcess:browser.tracked},timings),/AUTH_THEME_FIXTURE_CLEANUP_FAILED/);assert.equal(forced,true);assert.equal(server.tracked.hasClosed(),true);assert.equal(browser.tracked.hasClosed(),true);assert.equal(await exists(server.root),false);}finally{await emergency(server);await emergency(browser);}
});
test('SIGTERM refusal triggers owned process-group SIGKILL, observed close, and a failing cleanup result',async()=>{
 const f=await fixture("process.on('SIGTERM',()=>{});process.stdout.write('ready\\n');setInterval(()=>{},1000)");await once(f.child.stdout,'data');
 try{await assert.rejects(cleanupAuthThemeFixture({root:f.root,server:f.tracked},timings),/AUTH_THEME_FIXTURE_CLEANUP_FAILED/);assert.equal(f.child.signalCode,'SIGKILL');assert.equal(f.tracked.hasClosed(),true);assert.equal(await exists(f.root),false);}finally{await emergency(f);}
});
test('unconfirmed close retains the directory instead of deleting live resources',async()=>{
 const f=await fixture();const missingClose={...f.tracked,hasClosed:()=>false,closed:new Promise<void>(()=>{})};
 try{await assert.rejects(cleanupAuthThemeFixture({root:f.root,server:missingClose},timings),/AUTH_THEME_FIXTURE_CLEANUP_FAILED/);assert.equal(await exists(join(f.root,'sentinel')),true);}finally{await emergency(f);}
});
