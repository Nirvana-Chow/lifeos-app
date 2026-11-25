import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { PersonalPage } from '../../../src/personal-candidate/personal-page';
import { JournalActivityPage } from '../../../src/personal-daily/activity-review/journal-activity-page';
import { activityDate } from '../../../src/personal-daily/activity-review/activity.mjs';
import { beijingJournalDate } from '../../../src/personal-journal/history';
import { mergedSlices } from '../../../src/ui-review/requirements-delivery';
import { readPlatformPagePrincipal } from '../../../src/platform/runtime';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'LifeOS · 每日活动', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ date?: string | string[] }> }) {
  if (!await readPlatformPagePrincipal(await headers()).catch(() => null)) redirect('/login');
  const [template, styles, params] = await Promise.all([
    readFile(join(process.cwd(), 'src/personal-daily/activity-review/index.html'), 'utf8'),
    readFile(join(process.cwd(), 'src/personal-daily/activity-review/review.css'), 'utf8'),
    searchParams,
  ]);
  const markup = /<body>([\s\S]*)<\/body>/.exec(template)?.[1];
  if (!markup) throw new Error('Activity layout unavailable');
  const initialDate = activityDate(params.date);
  const serverDay = beijingJournalDate(new Date().toISOString());
  const mergeReceipts = Array.from(mergedSlices.values());
  return <PersonalPage title="每日活动" initialPage="overview" wide>
    <JournalActivityPage markup={markup} styles={styles} initialDate={initialDate} serverDay={serverDay} mergeReceipts={mergeReceipts} />
  </PersonalPage>;
}
