import { readJournalHistory } from '../../personal-journal/history.ts';

type JournalSourceFetcher = Parameters<typeof readJournalHistory>[0];
type JournalActivityEntry = {
  id: string;
  sourceId: string;
  revision: number;
  title: string;
  href: string;
  source: 'memos' | 'diary';
  when: { date: string };
};

export type JournalActivityInput =
  | { state: 'ready'; asOf: string; entries: JournalActivityEntry[]; classificationPending: boolean }
  | { state: 'unauthorized' | 'unknown' };

/** The caller supplies the existing authenticated, same-origin journal reader. */
export async function readJournalActivity(fetcher: NonNullable<JournalSourceFetcher>): Promise<JournalActivityInput> {
  let denied = false;
  try {
    const { history, sources } = await readJournalHistory(async (input, init) => {
      const response = await fetcher(input, init);
      if (response.status === 401 || response.status === 403) denied = true;
      if (response.ok && input === '/api/platform/personal/status') {
        const status: { storageVerified?: unknown; allowedTypes?: unknown } = await response.clone().json();
        if (status?.storageVerified === true && Array.isArray(status.allowedTypes) && !status.allowedTypes.includes('journal')) {
          denied = true;
        }
      }
      return response;
    });
    const entries = (['memos','diary'] as const).flatMap(source => sources[source].rows.flatMap(({ id, sourceId, revision, title, href, occurredOn }) =>
      occurredOn !== null && occurredOn <= history.today
        ? [{ id, sourceId, revision, title, href, source, when: { date: occurredOn } }]
        : [],
    ));
    // A full current snapshot still does not certify historical coverage.
    return { state: 'ready', asOf: history.today, entries, classificationPending: sources.unclassified.length > 0 };
  } catch {
    return { state: denied ? 'unauthorized' : 'unknown' };
  }
}

/** Safe for an inert script element when a reviewed caller embeds this payload. */
export function journalActivityJson(input: JournalActivityInput): string {
  return JSON.stringify(input).replaceAll('<', '\\u003c');
}
