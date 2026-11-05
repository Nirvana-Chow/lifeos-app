import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const script=resolve('scripts/ci/prepare-runner-cjk-fonts.sh');
const hash='7d64b985f6fe128c99eae5610d5c047338e572bdcfb2bb09736be01b824a7f6c';
const filename='fonts-noto-cjk_20230817+repack1-3_all.deb';
const realSha256=spawnSync('which',['sha256sum'],{encoding:'utf8'}).stdout.trim();
const realTimeout=spawnSync('which',['timeout'],{encoding:'utf8'}).stdout.trim();
// All OS/package commands are isolated; no sudo, installation or network is used.
function fixture(mode:string,cached?:string){
 const root=mkdtempSync(join(tmpdir(),'lifeos-ci-font-')),bin=join(root,'bin'),cache=join(root,'cache'),log=join(root,'commands');
 mkdirSync(bin);mkdirSync(cache);writeFileSync(log,'');
 const stub=(name:string,body:string)=>writeFileSync(join(bin,name),'#!/bin/bash\nset -euo pipefail\nprintf \'%s\\n\' "'+name+' $*" >> "$FONT_TEST_LOG"\n'+body+'\n',{mode:0o755});
 stub('dpkg-query',`if [[ "$FONT_TEST_MODE" == installed || -f "$FONT_TEST_ROOT/installed" ]]; then printf 'installed 1:20230817+repack1-3\\n'; else exit 1; fi`);
 stub('curl',`if [[ "$FONT_TEST_MODE" == download-fail ]]; then exit 28; fi
 if [[ "$FONT_TEST_MODE" == stalled ]]; then sleep 30; exit 28; fi
 while [[ "$1" != --output ]]; do shift; done
 if [[ "$FONT_TEST_MODE" == corrupt-download ]]; then printf poison > "$2"; else printf 'trusted synthetic font package' > "$2"; fi`);
 stub('sha256sum',`if [[ "$FONT_TEST_MODE" == poisoned-cache ]]; then exec "$FONT_TEST_SHA256" "$@"; fi
 IFS= read -r line
 if [[ "$line" != '${hash}  '* ]]; then exit 1; fi
 file="\${line#*  }"
 [[ "$(cat "$file")" == 'trusted synthetic font package' ]]`);
 stub('dpkg-deb',`if [[ "$FONT_TEST_MODE" == wrong-package ]]; then printf 'Package: evil\\nVersion: 1:20230817+repack1-3\\nArchitecture: all\\n'; else printf 'Package: fonts-noto-cjk\\nVersion: 1:20230817+repack1-3\\nArchitecture: all\\n'; fi`);
 stub('sudo',`[[ "$*" == '-n timeout --kill-after=5s 35s dpkg --install '* ]]
 if [[ "$FONT_TEST_MODE" == install-fail ]]; then exit 1; fi
 if [[ "$FONT_TEST_MODE" != wrong-readback ]]; then touch "$FONT_TEST_ROOT/installed"; fi`);
 if(mode==='stalled')stub('timeout',`[[ "$1" == --kill-after=5s && "$2" == 180s ]] || exit 99
 shift 2
 exec "$FONT_TEST_TIMEOUT" --kill-after=1s 1s "$@"`);
 if(cached!==undefined)writeFileSync(join(cache,filename),cached);
 return {root,cache,log,run:()=>spawnSync('bash',[script],{encoding:'utf8',timeout:5000,env:{...process.env,PATH:bin+':'+process.env.PATH,RUNNER_TEMP:root,LIFEOS_CJK_FONT_CACHE_DIR:cache,FONT_TEST_ROOT:root,FONT_TEST_MODE:mode,FONT_TEST_LOG:log,FONT_TEST_SHA256:realSha256,FONT_TEST_TIMEOUT:realTimeout}})};
}
for(const [mode,cached] of [['installed',undefined],['cached','trusted synthetic font package'],['download',undefined]] as const){
 test('CI CJK font preparation accepts '+mode,()=>{const f=fixture(mode,cached);try{
  const r=f.run();assert.equal(r.status,0,r.stderr);const log=readFileSync(f.log,'utf8');
  if(mode==='installed'){assert.doesNotMatch(log,/curl|sha256sum|sudo/);}else{
   assert.match(log,/sha256sum --check --status/);assert.match(log,/sudo -n timeout --kill-after=5s 35s dpkg --install/);
   assert.ok(log.indexOf('sha256sum')<log.indexOf('sudo'));
   if(mode==='cached')assert.doesNotMatch(log,/curl/);else{
    assert.match(log,/--connect-timeout 10/);assert.match(log,/--max-time 65/);assert.match(log,/--retry 1/);assert.match(log,/--retry-max-time 135/);
    assert.match(log,/https:\/\/archive\.ubuntu\.com\/ubuntu\/pool\/main\/f\/fonts-noto-cjk\/fonts-noto-cjk_20230817\+repack1-3_all.deb/);
    assert.equal(readFileSync(join(f.cache,filename),'utf8'),'trusted synthetic font package');
   }
  }
 }finally{rmSync(f.root,{recursive:true,force:true});}});
}
for(const [mode,cached] of [['poisoned-cache','poison'],['download-fail',undefined],['corrupt-download',undefined],['wrong-package',undefined]] as const){
 test('CI CJK font preparation rejects '+mode+' before privileged installation',()=>{const f=fixture(mode,cached);try{
  const r=f.run();assert.notEqual(r.status,0,JSON.stringify({stdout:r.stdout,stderr:r.stderr,log:readFileSync(f.log,'utf8')}));assert.notEqual(r.status,null,r.stderr);
  const log=readFileSync(f.log,'utf8');assert.doesNotMatch(log,/sudo/);
  if(mode==='download-fail')assert.match(log,/curl/);else assert.match(log,/sha256sum/);
  if(mode==='poisoned-cache'||mode==='corrupt-download')assert.match(r.stderr,/SHA256 mismatch/);
  if(mode==='wrong-package')assert.match(r.stderr,/Unexpected font package identity/);
  if(mode==='poisoned-cache')assert.doesNotMatch(log,/curl/);
 }finally{rmSync(f.root,{recursive:true,force:true});}});
}
for(const mode of ['install-fail','wrong-readback'])test('CI CJK font preparation fails closed on '+mode,()=>{const f=fixture(mode);try{
 const r=f.run();assert.notEqual(r.status,0);assert.notEqual(r.status,null,r.stderr);
 assert.match(readFileSync(f.log,'utf8'),/sudo/);
}finally{rmSync(f.root,{recursive:true,force:true});}});
test('the real overall deadline terminates a stalled download without installation',()=>{const f=fixture('stalled');try{
 // Check the production 180s invocation, then scale only the test clock to 1s.
 const started=Date.now(),r=f.run();assert.equal(r.status,124,r.stderr);assert.ok(Date.now()-started<4000);
 const log=readFileSync(f.log,'utf8');assert.match(log,/timeout --kill-after=5s 180s/);assert.match(log,/curl/);assert.doesNotMatch(log,/sudo/);
}finally{rmSync(f.root,{recursive:true,force:true});}});
test('both CJK font workflow steps retain bounded Chinese, copyright and Chrome/NSS checks',()=>{
 for(const file of ['qualification.yml','visual-qualification.yml']){
  const workflow=readFileSync('.github/workflows/'+file,'utf8');
  const step=workflow.match(/      - name: Install fixed runner-only Chinese fonts and check native Chrome\/NSS\n([\s\S]*?)(?=      - name:)/)?.[1];
  assert.ok(step);assert.match(step,/timeout-minutes: 4/);assert.match(step,/bash scripts\/ci\/prepare-runner-cjk-fonts.sh/);
  assert.match(step,/test -s \/usr\/share\/doc\/fonts-noto-cjk\/copyright/);
  assert.match(step,/timeout --kill-after=5s 25s fc-cache -f/);
  assert.match(step,/fc-match -f '%\{family\}' 'sans-serif:lang=zh-cn'/);assert.match(step,/Noto Sans CJK/);
  assert.match(step,/command -v google-chrome/);assert.match(step,/command -v certutil/);assert.doesNotMatch(step,/apt-get|continue-on-error/);
 }
 const helper=readFileSync(script,'utf8');assert.match(helper,/exec timeout --kill-after=5s 180s/);
 assert.doesNotMatch(helper,/apt-get|--retry-all-errors/);
});
