import {createHash} from 'node:crypto';
import {reviewDocument} from './document.ts';

function inlineHash(tag: 'script' | 'style') {
  const opening = '<' + tag + '>';
  const start = reviewDocument.indexOf(opening);
  const end = reviewDocument.indexOf('</' + tag + '>', start);
  if (start < 0 || end < 0) throw new Error('Storage review document is missing its inline ' + tag);
  const content = reviewDocument.slice(start + opening.length, end);
  return "'sha256-" + createHash('sha256').update(content).digest('base64') + "'";
}

const responseHeaders = {
  'Cache-Control': 'private, no-store',
  'Content-Security-Policy': [
    "default-src 'none'",
    "connect-src 'self'",
    'script-src ' + inlineHash('script'),
    'style-src ' + inlineHash('style'),
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; '),
  'Referrer-Policy': 'no-referrer',
  'Vary': 'Cookie',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

export async function storageReviewResponse(readOwner: () => Promise<unknown>) {
  let owner = null;
  try {
    owner = await readOwner();
  } catch {
    // Owner pages fail closed if the authentication service is unavailable.
  }
  if (!owner) {
    return new Response(null, {status:307, headers:{...responseHeaders, Location:'/login'}});
  }
  return new Response(reviewDocument, {
    headers:{...responseHeaders, 'Content-Type':'text/html; charset=utf-8'},
  });
}
