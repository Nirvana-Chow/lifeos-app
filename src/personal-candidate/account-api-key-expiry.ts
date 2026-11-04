const day = 86_400_000;

export function resolveApiKeyExpiry(choice: string, localTime: string, now = new Date()): {expiresInDays: number} | {expiresAt: string} | null {
  if (choice === '7' || choice === '30' || choice === '90' || choice === '365') {
    return {expiresInDays: Number(choice)};
  }

  const parts = choice === 'custom' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localTime);
  if (!parts) return null;
  const [year, month, date, hours, minutes] = parts.slice(1).map(Number);
  const expiry = new Date(year, month - 1, date, hours, minutes);
  if (expiry.getFullYear() !== year || expiry.getMonth() !== month - 1 || expiry.getDate() !== date ||
      expiry.getHours() !== hours || expiry.getMinutes() !== minutes ||
      +expiry <= +now || +expiry > +now + 365 * day) return null;
  return {expiresAt: expiry.toISOString()};
}

/** Preview only: the issuer measures preset durations when it creates the key. */
export function estimateApiKeyExpiry(choice: string, now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): string | null {
  const duration = resolveApiKeyExpiry(choice, '', now);
  if (!duration || !('expiresInDays' in duration)) return null;
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(+now + duration.expiresInDays * day));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
  return `${value('year')}/${value('month')}/${value('day')} ${value('hour')}:${value('minute')}（${timeZone}）`;
}
