import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {posix} from 'node:path';
import {gunzipSync} from 'node:zlib';
import test from 'node:test';
import {renderAgentOperations} from '../scripts/agent-skill-reference.ts';

// A missing file, stale operation reference, or accidentally bundled private
// runtime would break installation or expose data to an anonymous downloader.
test('the anonymous download is a self-contained, generic Skill archive', async () => {
  const {GET} = await import('../app/api/platform/agent-skill/route.ts');
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/gzip');
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="lifeos-agent.tar.gz"');
  assert.equal(response.headers.get('set-cookie'), null);
  const archive = gunzipSync(Buffer.from(await response.arrayBuffer()));
  const files = new Map<string,string>();
  for (let offset=0;offset<archive.length;) {
    const header = archive.subarray(offset,offset+512);
    if (header.every(byte=>byte===0)) break;
    const name = header.subarray(0,100).toString().split('\0')[0];
    const size = parseInt(header.subarray(124,136).toString().replaceAll('\0','').trim(),8);
    assert.ok(!name.startsWith('/')&&!name.includes('..'), 'archive uses safe relative paths');
    assert.ok(!files.has(name), 'no duplicate archive entry');
    files.set(name,archive.subarray(offset+512,offset+512+size).toString());
    offset += 512+Math.ceil(size/512)*512;
  }
  assert.deepEqual([...files.keys()].sort(),[
    'lifeos-agent/LICENSE',
    'lifeos-agent/SKILL.md',
    'lifeos-agent/references/credential-runtime.md',
    'lifeos-agent/references/operations.md',
  ]);
  assert.equal(files.get('lifeos-agent/references/operations.md'),renderAgentOperations());
  assert.equal(files.get('lifeos-agent/LICENSE'),readFileSync(new URL('../LICENSE',import.meta.url),'utf8'));
  for (const path of ['SKILL.md','references/credential-runtime.md']) {
    assert.equal(files.get('lifeos-agent/'+path),readFileSync(new URL('../skills/lifeos-agent/'+path,import.meta.url),'utf8'),
      'Regenerate the public Skill module after reviewing generic source changes.');
  }
  for (const [name,content] of files) {
    for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(https?:|#)/.test(match[1])) continue;
      const linked=posix.normalize(posix.join(posix.dirname(name),match[1]));
      assert.ok(files.has(linked),'Unresolved Skill reference: '+linked);
    }
    assert.doesNotMatch(content,/\/Users\/|local-runtime|57317560|synthetic-account-owner|fixture-only-lifeos-agent-key/);
  }
});
