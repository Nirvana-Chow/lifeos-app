import type { PersonalBinding, PersonalFetch } from '../personal-candidate/client.ts';
import { ownerRecord, recordFields } from '../personal-candidate/record-model.ts';
import { cookingReadOptions, readCookingAccess, sameCookingBinding } from './log-access.ts';
import type { CookingFields } from './log-domain.ts';

const cookingRecordsPath = '/api/platform/personal/cooking';

export type CookingLogRow = {
  id: string;
  sourceId: string;
  revision: number;
  createdAt: string;
  fields: CookingFields;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function cookingLogRow(entry: unknown, spaceId: string): CookingLogRow {
  const row = ownerRecord(entry, 'cooking', spaceId);
  if (typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) throw Error('记录日期无法核对。');
  return {
    id:row.id,
    sourceId:row.source.id,
    revision:row.revision,
    createdAt:row.createdAt,
    fields:recordFields(row, 'cooking') as CookingFields,
  };
}

export function sortCookingRows(rows: readonly CookingLogRow[]) {
  return rows.toSorted((left, right) =>
    right.fields.occurredOn.localeCompare(left.fields.occurredOn)
    || right.createdAt.localeCompare(left.createdAt)
    || left.id.localeCompare(right.id),
  );
}

export async function loadCookingHistory(fetcher: PersonalFetch, signal: AbortSignal) {
  const before = await readCookingAccess(fetcher, signal);
  if (!before) throw Error('当前空间尚未开放做饭记录。');
  const response = await fetcher(cookingRecordsPath + '/snapshot', cookingReadOptions(signal));
  const value: unknown = response.ok ? await response.json() : null;
  if (!isObject(value) || value.scope !== 'full-current-snapshot' || value.truncated !== false
    || !Array.isArray(value.items) || value.items.length !== value.total) {
    throw Error('做饭历史没有完整读回，请重试。');
  }
  const rows = value.items.map(entry => cookingLogRow(entry, before.spaceId));
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw Error('做饭历史无法核对，请重试。');
  const access = await readCookingAccess(fetcher, signal);
  if (!access || !sameCookingBinding(before, access)) throw Error('本人空间或记录权限已变化，请重新核对。');
  return { access, rows:sortCookingRows(rows) };
}

export async function readCookingRecord(
  fetcher: PersonalFetch,
  binding: PersonalBinding,
  expected: CookingLogRow,
  signal: AbortSignal,
) {
  const response = await fetcher(cookingRecordsPath + '/' + expected.id, cookingReadOptions(signal));
  const value: unknown = response.ok ? await response.json() : null;
  if (!isObject(value)) throw Error('做饭记录读取失败，请重试。');
  const row = cookingLogRow(value.entry, binding.spaceId);
  if (row.id !== expected.id || row.sourceId !== expected.sourceId || row.revision < expected.revision) {
    throw Error('做饭记录无法核对，请重新读取历史。');
  }
  const access = await readCookingAccess(fetcher, signal);
  if (!access || !sameCookingBinding(binding, access)) throw Error('本人空间或记录权限已变化，请重新核对。');
  return { access, row };
}
