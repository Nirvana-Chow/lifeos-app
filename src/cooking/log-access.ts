import type { PersonalBinding, PersonalFetch } from '../personal-candidate/client.ts';

export const cookingStatusPath = '/api/platform/personal/status';
export type CookingAccess = PersonalBinding & { writable: boolean };

function statusWithBinding(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = value as Record<string, unknown>;
  if (status.scope !== 'personal-manual-candidate' || typeof status.ownerId !== 'string' || typeof status.spaceId !== 'string'
    || !/^[A-Za-z0-9_-]{6,80}$/.test(status.ownerId) || !/^[A-Za-z0-9_-]{8,80}$/.test(status.spaceId)) return null;
  return {
    ownerId:status.ownerId, spaceId:status.spaceId, writable:status.writable === true,
    storageVerified:status.storageVerified, cookingEnabled:status.cookingEnabled,
  };
}

export function parseCookingAccess(value: unknown): CookingAccess | null {
  const status = statusWithBinding(value);
  if (status?.storageVerified !== true || status.cookingEnabled !== true) return null;
  return { ownerId:status.ownerId, spaceId:status.spaceId, writable:status.writable };
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

export class CookingScopeLost extends Error {
  constructor() { super('本人身份或做饭记录权限已变化，请重新读取。'); }
}

export async function verifyCookingMutationAccess(
  response: Response,
  input: RequestInfo | URL,
  binding: PersonalBinding,
) {
  if (response.status === 401 || response.status === 403) throw new CookingScopeLost();
  if (response.status === 404) {
    const body = await response.clone().json().catch(() => null);
    if (body?.error?.code === 'PERSONAL_MODULE_UNAVAILABLE') throw new CookingScopeLost();
  }
  if (input !== cookingStatusPath || !response.ok) return;
  const status = statusWithBinding(await response.clone().json());
  if (status && (!sameCookingBinding(status, binding) || status.storageVerified === false || status.cookingEnabled === false)) {
    throw new CookingScopeLost();
  }
  if (status?.storageVerified !== true || status.cookingEnabled !== true) {
    throw Error('暂时无法核对做饭记录权限。');
  }
}
