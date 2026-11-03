import {isHTTPSOrigin, type PlatformConfig} from '../platform/config.ts';
import type {PersonalConfig} from '../personal-candidate/config.ts';

export const agentRuntimeKeys = [
  'LIFEOS_AGENT_API_ENABLED',
  'LIFEOS_AGENT_API_DATABASE_URL',
  'LIFEOS_AGENT_API_SECRET',
] as const;

export const agentVerifierRole = 'lifeos_agent_verifier';

export function readAgentRuntimeConfig(
  env: Record<string, string | undefined>,
  platform: PlatformConfig,
  personal: PersonalConfig | null,
): Readonly<{databaseURL: string; secret: string}> | null {
  if (agentRuntimeKeys.every(key => env[key] === undefined)) return null;

  const invalid = (): never => { throw Error('Agent runtime configuration unavailable'); };
  const databaseURL = env.LIFEOS_AGENT_API_DATABASE_URL;
  const secret = env.LIFEOS_AGENT_API_SECRET;
  if (env.LIFEOS_AGENT_API_ENABLED !== '1' || !personal || personal.transport === 'ssh-loopback' ||
      !personal.allowedTypes.includes('todo') || !databaseURL || !secret ||
      Buffer.byteLength(secret) < 32 || Buffer.byteLength(secret) > 512 || secret === platform.secret) return invalid();

  try {
    const database = new URL(databaseURL);
    const business = new URL(platform.databaseURL);
    if (!isHTTPSOrigin(new URL(platform.baseURL)) || !['postgres:', 'postgresql:'].includes(database.protocol) ||
        database.hostname !== '127.0.0.1' || database.port !== business.port ||
        database.pathname !== business.pathname || database.pathname !== '/' + personal.databaseName ||
        database.username !== agentVerifierRole || !database.password || database.search || database.hash) return invalid();
  } catch {
    return invalid();
  }
  return Object.freeze({databaseURL, secret});
}
