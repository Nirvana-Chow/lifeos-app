import { mountActivity } from './view.mjs';

const payload = document.querySelector('#journal-activity-input');
if (payload) {
  let mapping = { state: 'unknown' };
  try {
    const parsed = JSON.parse(payload.textContent);
    if (parsed?.state === 'unauthorized' ||
        parsed?.state === 'ready' && Array.isArray(parsed.entries) && /^\d{4}-\d{2}-\d{2}$/.test(parsed.asOf)) {
      mapping = parsed;
    }
  } catch {
    // Invalid review data must never activate synthetic fixtures.
  }
  mountActivity(document, mapping, { isolated: true });
} else {
  const { sources: fixtures } = await import('./fixtures.mjs');
  mountActivity(document, null, { fixtures });
}
