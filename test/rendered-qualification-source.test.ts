import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

test('synthetic TLS qualification owns a source-only image and anonymous fixture, excluding legacy demos',()=>{
 for(const path of ['Dockerfile.platform-review','.dockerignore','test/fixtures/Caddyfile.synthetic','test/helpers/owner-recovery-https-setup.ts','test/helpers/personal-synthetic-bootstrap.ts','test/helpers/private-business-browser-fixture.ts'])assert.equal(existsSync(path),true,path+' must exist');
 const caddy=readFileSync('test/fixtures/Caddyfile.synthetic','utf8');
 assert.match(caddy,/review\.example\.test/);assert.doesNotMatch(caddy,/review\/admin|nirvanachow|20261023|lifeos\.example/);
 const setup=readFileSync('test/helpers/owner-recovery-https-setup.ts','utf8');assert.match(setup,/test\/fixtures\/Caddyfile\.synthetic/);assert.doesNotMatch(setup,/ops\/https|personal-candidate\/bootstrap|20261023|staticReview/);
 const docker=readFileSync('Dockerfile.platform-review','utf8');assert.match(docker,/FROM node:24\.22\.1-bookworm-slim@sha256:[0-9a-f]{64}/);assert.match(docker,/USER node/);assert.match(docker,/platform-image-metadata\.mjs/);
 const ignored=readFileSync('.dockerignore','utf8');assert.equal(ignored.split('\n')[0],'**');assert.doesNotMatch(ignored,/!\.env|!\.superpowers|!test|!ops/);
});
test('browser groups preserve original bounds and publish only an in-process handoff after cleanup',()=>{
 const browser=readFileSync('test/owner-recovery-browser.integration.test.ts','utf8'),workspace=readFileSync('test/helpers/personal-workspace-browser-fixture.ts','utf8');
 assert.match(browser,/let completedHandoff:PrivateBrowserHandoff\|undefined/);assert.match(browser,/timeout:180000/);assert.match(browser,/now\+300000/);assert.match(browser,/completedHandoff=pendingHandoff/);assert.match(browser,/PRIVATE_BROWSER_GROUP/);
 assert.equal((browser.match(/await verifyPersisted\(\)/g)??[]).length,2);
 assert.match(workspace,/return \{verifyPersisted:/);assert.doesNotMatch(workspace,/phase='presentation-matrix';await verifyPersonalPresentations/);
 assert.doesNotMatch(browser,/writeFileSync\([^\n]*cookies|JSON\.stringify\(pendingHandoff|JSON\.stringify\(completedHandoff/);
});
