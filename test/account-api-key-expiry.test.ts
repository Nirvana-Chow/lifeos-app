import assert from 'node:assert/strict';
import {test} from 'node:test';
import {estimateApiKeyExpiry, resolveApiKeyExpiry} from '../src/personal-candidate/account-api-key-expiry.ts';

const now = new Date(2026, 10, 4, 10, 0);

test('presets ask the issuer to measure the duration', () => {
  for (const days of ['7', '30', '90', '365']) {
    assert.deepEqual(resolveApiKeyExpiry(days, '', now), {expiresInDays: Number(days)});
  }
});

test('custom expiry uses local time and rejects dates outside the allowed window', () => {
  assert.deepEqual(resolveApiKeyExpiry('custom', '2026-11-04T10:01', now), {expiresAt: new Date(2026, 10, 4, 10, 1).toISOString()});
  assert.equal(resolveApiKeyExpiry('custom', '2027-11-05T10:00', now), null);
  assert.equal(resolveApiKeyExpiry('custom', '2026-11-04T10:00', now), null);
  assert.equal(resolveApiKeyExpiry('custom', '2026-11-31T10:00', now), null);
  assert.equal(resolveApiKeyExpiry('custom', '', now), null);
  assert.equal(resolveApiKeyExpiry('366', '', now), null);
});

test('preset estimate uses elapsed days across month, year and leap-year boundaries in the displayed timezone', () => {
  for (const [choice, instant, expected] of [
    ['7', '2026-01-28T16:30:00Z', '2026/02/05 00:30'],
    ['30', '2026-12-15T16:30:00Z', '2027/01/15 00:30'],
    ['365', '2027-02-28T16:30:00Z', '2028/02/29 00:30'],
    ['90', '2026-10-31T16:30:00Z', '2027/01/30 00:30'],
  ]) {
    const estimate = estimateApiKeyExpiry(choice, new Date(instant), 'Asia/Shanghai');
    assert.equal(estimate, expected + '（Asia/Shanghai）');
  }
  assert.equal(estimateApiKeyExpiry('custom', now, 'Asia/Shanghai'), null);
  assert.equal(estimateApiKeyExpiry('366', now, 'Asia/Shanghai'), null);
});
