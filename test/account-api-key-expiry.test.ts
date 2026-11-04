import assert from 'node:assert/strict';
import {test} from 'node:test';
import {resolveApiKeyExpiry} from '../src/personal-candidate/account-api-key-expiry.ts';

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
