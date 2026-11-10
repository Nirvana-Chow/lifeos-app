import type { PersonalBinding, PersonalFetch } from '../personal-candidate/client.ts';

export const cookingStatusPath = '/api/platform/personal/status';
export type CookingAccess = PersonalBinding & { writable: boolean };

export function parseCookingAccess(value: unknown): CookingAccess | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = value as Record<string, unknown>;
  if (status.scope !== 'personal-manual-candidate' || status.storageVerified !== true
    || status.cookingEnabled !== true || typeof status.ownerId !== 'string' || typeof status.spaceId !== 'string'
    || !/^[A-Za-z0-9_-]{6,80}$/.test(status.ownerId) || !/^[A-Za-z0-9_-]{8,80}$/.test(status.spaceId)) return null;
  return { ownerId:status.ownerId, spaceId:status.spaceId, writable:status.writable === true };
}

export function sameCookingBinding(first: PersonalBinding | null, second: PersonalBinding | null) {
  return !!first && !!second && first.ownerId === second.ownerId && first.spaceId === second.spaceId;
}

export const cookingReadOptions = (signal: AbortSignal): RequestInit => ({
  credentials:'same-origin', cache:'no-store', signal,
});

export async function readCookingAccess(fetcher: PersonalFetch, signal: AbortSignal) {
  const response = await fetcher(cookingStatusPath, cookingReadOptions(signal));
  if (!response.ok) return null;
  return parseCookingAccess(await response.json());
}
