import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { journalActivityJson, readJournalActivity } from './journal-source.ts';

const activityPath = '/personal/activity';
const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'Vary': 'Cookie',
  'X-Robots-Tag': 'noindex, nofollow',
};
const csp = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const readTemplate = () => readFile(join(process.cwd(), 'src/personal-daily/activity-review/index.html'), 'utf8');
const assets = {
  'review.css': {
    type: 'text/css; charset=utf-8',
    read: () => readFile(join(process.cwd(), 'src/personal-daily/activity-review/review.css'), 'utf8'),
  },
  'review.mjs': {
    type: 'text/javascript; charset=utf-8',
    read: () => readFile(join(process.cwd(), 'src/personal-daily/activity-review/review.mjs'), 'utf8'),
  },
  'activity.mjs': {
    type: 'text/javascript; charset=utf-8',
    read: () => readFile(join(process.cwd(), 'src/personal-daily/activity-review/activity.mjs'), 'utf8'),
  },
};

export async function activityAsset(name: string): Promise<Response> {
  if (!Object.hasOwn(assets, name)) return new Response(null, { status: 404, headers: privateHeaders });
  const asset = assets[name as keyof typeof assets];
  return new Response(await asset.read(), {
    headers: { ...privateHeaders, 'Content-Type': asset.type, 'X-Content-Type-Options': 'nosniff' },
  });
}

export async function activityDocument(
  request: Request,
  readOwner: (headers: Headers) => Promise<unknown>,
  readPlatform: (request: Request) => Promise<Response>,
): Promise<Response> {
  if (!await readOwner(request.headers).catch(() => null)) {
    return new Response(null, { status: 307, headers: { ...privateHeaders, Location: '/login' } });
  }
  const [template, journal] = await Promise.all([
    readTemplate(),
    readJournalActivity((path) => readPlatform(new Request(new URL(String(path), request.url), {
      headers: request.headers,
      method: 'GET',
      signal: request.signal,
    }))),
  ]);
  const data = '<script type="application/json" id="journal-activity-input">' + journalActivityJson(journal) + '</script>';
  const html = template
    .replace('<html lang="zh-CN">', '<html lang="zh-CN" data-activity-mode="journal">')
    .replace('LifeOS 日常 · 活动热力图评审', 'LifeOS 日常 · 活动热力图')
    .replace('href="./review.css"', 'href="' + activityPath + '/review.css"')
    .replace('src="./review.mjs"', 'src="' + activityPath + '/review.mjs"')
    .replace('合成数据 · 评审原型', '日记只读')
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]+>\s*/, '')
    .replace('</head>', data + '</head>');
  return new Response(html, {
    headers: { ...privateHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp },
  });
}
