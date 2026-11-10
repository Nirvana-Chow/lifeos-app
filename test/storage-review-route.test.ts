import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {storageReviewResponse} from '../app/personal/storage-review/response.ts';

test('storage review fails closed on anonymous requests and auth errors', async () => {
  for (const readOwner of [async () => null, async () => {throw new Error('unavailable');}]) {
    const result = await storageReviewResponse(readOwner);
    assert.equal(result.status, 307);
    assert.equal(result.headers.get('location'), '/login');
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
    assert.equal(await result.text(), '');
  }
});

test('owner receives an empty local-only review document with exact CSP hashes', async () => {
  const result = await storageReviewResponse(async () => ({id:'synthetic-owner'}));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal(result.headers.get('vary'), 'Cookie');
  assert.match(result.headers.get('x-robots-tag') ?? '', /noindex/);
  const document = await result.text();
  assert.match(document, /id="review-data">\{"schema":1,"revision":"empty","items":\[\]\}/);
  assert.match(document, /accept="\.csv,\.json,text\/csv,application\/json"/);
  const csp = result.headers.get('content-security-policy') ?? '';
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /'unsafe-inline'|https?:/);
  for (const tag of ['script','style']) {
    const content = document.match(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>'))?.[1];
    assert.ok(content);
    assert.ok(csp.includes("'sha256-"+createHash('sha256').update(content).digest('base64')+"'"));
  }
});
