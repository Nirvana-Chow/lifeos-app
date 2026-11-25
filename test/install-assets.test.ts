import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {GET} from '../app/api/platform/install/manifest.webmanifest/route.ts';
import {lifeOSInstallMetadata} from '../src/ui-review/install-metadata.ts';

test('install metadata and icons use the existing HTTPS application route', async () => {
  const metadata: import('next').Metadata = lifeOSInstallMetadata;
  const prefix = '/api/platform/install/';
  assert.equal(metadata.manifest, prefix + 'manifest.webmanifest');
  assert.deepEqual(metadata.icons, {
    icon: prefix + 'icon.svg',
    apple: prefix + 'apple-icon.png',
  });
  const source = new URL('../app' + prefix, import.meta.url);
  const response = GET();
  assert.equal(response.headers.get('content-type'), 'application/manifest+json');
  const manifest = await response.json();
  assert.equal(manifest.start_url, '/personal');
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(manifest.icons.map((icon: {src: string}) => icon.src), [
    prefix + 'icon.svg', prefix + 'apple-icon.png',
  ]);
  assert.match(readFileSync(new URL('icon.svg', source), 'utf8'), /<svg\b/);
  assert.equal(readFileSync(new URL('apple-icon.png', source)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});
