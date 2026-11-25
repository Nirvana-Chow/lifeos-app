const headings = ['## 计划', '## 发生', '## 总结'] as const;

export const journalRoutineTemplate = headings.join('\n\n') + '\n';

/** Only split an explicitly sectioned journal. Preserve the stored body for original reads. */
export function readJournalRoutine(body: string) {
  const lines = body.replaceAll('\r\n', '\n').split('\n');
  const boundaries = lines.flatMap((line, index) =>
    headings.some(heading => heading === line) ? [index] : []);
  if (boundaries.length !== headings.length || boundaries[0] !== 0 ||
      headings.some((heading, index) => lines[boundaries[index]] !== heading)) return null;

  const [, occurrence, summary] = boundaries;
  return {
    plan: lines.slice(1, occurrence).join('\n').trim(),
    happened: lines.slice(occurrence + 1, summary).join('\n').trim(),
    summary: lines.slice(summary + 1).join('\n').trim(),
  };
}
