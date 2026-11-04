import {request as requestLocal} from 'node:http';
import {PlatformError} from '../platform/domain.ts';
import {readPlatformConfig} from '../platform/config.ts';
import {assertLocalRequest, readJSONBody} from '../platform/request-boundary.ts';

import {keyManagementFlag, keyManagementSocket} from './key-management-config.ts';

const basePath = '/api/platform/account/api-keys';
const headers = {'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff'};
type Operation = 'list' | 'create' | 'revoke';
type Issuer = (operation: Operation, cookie: string, body: unknown) => Promise<Response>;

function failure(status: number, error: string) {
  return Response.json({error}, {status, headers});
}

export function createKeyManagementHandler(baseURL: string, issuer: Issuer) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const match = /^\/api\/platform\/account\/api-keys\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname);
    const operation = url.pathname === basePath
      ? request.method === 'GET' ? 'list' : request.method === 'POST' ? 'create' : null
      : match && request.method === 'DELETE' ? 'revoke' : null;
    const cursor = url.searchParams.get('cursor');
    if (!operation || (url.search && (operation !== 'list' || url.searchParams.size !== 1 || !cursor || cursor.length > 128)))
      return failure(404, 'NOT_FOUND');
    try {
      assertLocalRequest(request, baseURL);
      if (operation !== 'list' && request.headers.get('origin') !== new URL(baseURL).origin)
        return failure(403, 'ORIGIN_DENIED');
      const cookie = request.headers.get('cookie');
      if (request.headers.has('authorization') || !cookie || cookie.length > 8192)
        return failure(401, 'AUTH_REQUIRED');
      const body = operation === 'create' ? await readJSONBody(request) : operation === 'revoke' ? {id: match![1]} : cursor ? {cursor} : {};
      const response = await issuer(operation, cookie, body);
      if (response.status === 204 && operation === 'revoke') return new Response(null, {status: 204, headers});
      if ((response.status === 200 && operation === 'list') || (response.status === 201 && operation === 'create'))
        return Response.json(await response.json(), {status: response.status, headers});
      const safeErrors: Record<number, string> = {
        400: 'INVALID_KEY_REQUEST', 401: 'AUTH_REQUIRED', 403: 'ACCESS_DENIED',
        404: 'NOT_FOUND', 409: 'KEY_CONFLICT', 429: 'RATE_LIMITED',
      };
      return Object.hasOwn(safeErrors, response.status)
        ? failure(response.status, safeErrors[response.status])
        : failure(503, 'KEY_MANAGEMENT_UNAVAILABLE');
    } catch (error) {
      return error instanceof PlatformError ? failure(error.status, error.code) : failure(503, 'KEY_MANAGEMENT_UNAVAILABLE');
    }
  };
}

export function callKeyIssuer(socketPath: string, operation: Operation, cookie: string, body: unknown): Promise<Response> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const deadline = AbortSignal.timeout(7000);
    const request = requestLocal({
      socketPath, path: '/v1/keys/' + operation, method: 'POST', signal: deadline,
      headers: {Cookie: cookie, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload)},
    }, response => {
      const chunks: Buffer[] = [];
      let length = 0;
      response.on('error', reject);
      response.on('aborted', () => reject(Error('Issuer response interrupted')));
      response.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > 131072) request.destroy(Error('Issuer response too large'));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        const status = response.statusCode ?? 503;
        if (status < 200 || status > 599) return reject(Error('Invalid issuer response'));
        resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks).toString('utf8'), {status}));
      });
    });
    request.on('error', reject);
    request.end(payload);
  });
}

export async function handleKeyManagementRequest(request: Request): Promise<Response> {
  if (process.env[keyManagementFlag] !== '1') return failure(404, 'NOT_FOUND');
  const platform = readPlatformConfig(process.env);
  if (!platform || new URL(platform.baseURL).protocol !== 'https:') return failure(503, 'KEY_MANAGEMENT_UNAVAILABLE');
  return createKeyManagementHandler(platform.baseURL, (operation, cookie, body) => callKeyIssuer(keyManagementSocket, operation, cookie, body))(request);
}
