import {object, PlatformError, validateId, validateRevision} from '../platform/domain.ts';
import type {Command} from './domain.ts';

const invalid = () => new PlatformError(400, 'INVALID_LEARNING_COMMAND', '请核对词卡或复习内容。');
function field(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw invalid();
  return value.trim();
}
export function commandOf(value: unknown): Command {
  const kind = (value as {kind?: unknown} | null)?.kind;
  if (kind === 'create') {
    const row = object(value, ['kind','confirmed','front','back']);
    if (row.confirmed !== true) throw invalid();
    return {kind, confirmed: true, front: field(row.front, 240), back: field(row.back, 4000)};
  }
  if (kind === 'review') {
    const row = object(value, ['kind','confirmed','cardId','cardRevision','previousId','rating']);
    if (row.confirmed !== true || (row.rating !== 'again' && row.rating !== 'recalled')) throw invalid();
    return {kind, confirmed: true, cardId: validateId(row.cardId), cardRevision: validateRevision(row.cardRevision),
      previousId: row.previousId === null ? null : validateId(row.previousId), rating: row.rating};
  }
  throw invalid();
}
