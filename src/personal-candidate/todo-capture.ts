import {object,PlatformError, todoKeys, validateTodo} from '../platform/domain.ts';
import type {PublicEntry} from '../platform/contracts.ts';

export const todoOriginalLineLimit = 4096;
export const todoOriginalLinePattern = /^[^\r\n\u0000\u2028\u2029]*$/u;

export function validateTodoOriginalLine(value: unknown): string {
 if (typeof value !== 'string' || value.length > todoOriginalLineLimit || !todoOriginalLinePattern.test(value)) {
  throw new PlatformError(400, 'INVALID_TODO_ORIGINAL_LINE', '原始输入需要是一行文字，最多4096个字符。');
 }
 return value;
}

export function todoCaptureSource(entry: PublicEntry, spaceId: string) {
 const source = entry.source;
 if (entry.kind !== 'todo' || source.system !== 'website' || source.externalId !== entry.id || source.version !== 1) return null;
 try {
  const original = object(source.original, ['marker', 'type', 'spaceId', 'input']);
  if (original.marker !== 'personal-manual-v1' || original.type !== 'todo' || original.spaceId !== spaceId) return null;
  const input = object(original.input, ['spaceId', 'confirmed', 'fields', 'originalLine']);
  if (input.spaceId !== spaceId || input.confirmed !== true || !Object.hasOwn(input, 'originalLine')) return null;
  const originalLine = validateTodoOriginalLine(input.originalLine);
  const initial = validateTodo(object(input.fields, todoKeys));
  return {originalLine, initial};
 } catch {
  return null;
 }
}
