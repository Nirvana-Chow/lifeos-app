import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Viewport } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { PrivacyBoundary } from '../../../src/personal-candidate/privacy';
import { JournalActivityPage } from '../../../src/personal-daily/activity-review/journal-activity-page';
import { readPlatformPagePrincipal } from '../../../src/platform/runtime';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'LifeOS · 每日活动', robots: { index: false, follow: false } };
export const viewport: Viewport = { width: 1024 };

export default async function Page() {
  if (!await readPlatformPagePrincipal(await headers()).catch(() => null)) redirect('/login');
  const [template, styles] = await Promise.all([
    readFile(join(process.cwd(), 'src/personal-daily/activity-review/index.html'), 'utf8'),
    readFile(join(process.cwd(), 'src/personal-daily/activity-review/review.css'), 'utf8'),
  ]);
  const markup = /<body>([\s\S]*)<\/body>/.exec(template)?.[1];
  if (!markup) throw new Error('Activity layout unavailable');
  return <PrivacyBoundary><JournalActivityPage markup={markup} styles={styles} /></PrivacyBoundary>;
}
