import {createHash} from 'node:crypto';
import {PlatformError} from '../platform/domain.ts';
import {assertLocalRequest, readJSONBody} from '../platform/request-boundary.ts';
import type {Binding} from './domain.ts';
import type {LearningService} from './service.ts';

export type LearningAccess = {binding: Binding; writable: boolean};
export type LearningRuntime = {
  service: LearningService;
  baseURL: string;
  authorize(request: Request, write: boolean): Promise<LearningAccess>;
};

const scopeOf = (binding: Binding) => createHash('sha256')
  .update(JSON.stringify(['vocabulary', binding.ownerId, binding.spaceId])).digest('hex');

const response = (body: unknown, status = 200) => Response.json(body, {
  status, headers: {'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff', Vary:'Cookie'},
});

export async function handleLearningRequest(request: Request, runtime: LearningRuntime | null) {
  if (!runtime) return response({error: {code:'LEARNING_UNAVAILABLE', message:'词卡暂未开放。'}}, 404);
  try {
    assertLocalRequest(request, runtime.baseURL);
    const write = request.method === 'POST';
    if (write && request.headers.get('origin') !== new URL(runtime.baseURL).origin) {
      throw new PlatformError(403, 'ORIGIN_DENIED', '保存需要相同来源。');
    }
    const access = await runtime.authorize(request, write);
    const scope = scopeOf(access.binding);
    if (write && request.headers.get('x-learning-scope') !== scope) {
      throw new PlatformError(403, 'LEARNING_ACCESS_CHANGED', '词卡权限已变化。');
    }
    const check = async () => {
      const current = await runtime.authorize(request, write);
      if (request.signal.aborted || access.binding.ownerId !== current.binding.ownerId ||
          access.binding.spaceId !== current.binding.spaceId || (write && (!access.writable || !current.writable))) {
        throw new PlatformError(403, 'LEARNING_ACCESS_CHANGED', '词卡权限已变化。');
      }
      return current;
    };
    const params = new URL(request.url).searchParams;
    const card = params.get('card');
    const review = params.get('review');
    if ([...params.keys()].some(key => !['card','review'].includes(key) || params.getAll(key).length !== 1) ||
        (review !== null && !card) || card === '' || review === '' || (write && params.size)) {
      throw new PlatformError(400, 'INVALID_LEARNING_QUERY', '请核对词卡查询。');
    }
    if (write) {
      await check();
      const receipt = await runtime.service.mutate(access.binding, await readJSONBody(request),
        request.headers.get('idempotency-key') ?? '', async () => {await check();});
      await check();
      return response(receipt);
    }
    const data = card ? await runtime.service.detail(access.binding, card, review) :
      await runtime.service.snapshot(access.binding);
    const current = await check();
    return response({...data, scope, writable: current.writable});
  } catch (error) {
    if (error instanceof PlatformError) return response({error: {code:error.code, message:error.message}}, error.status);
    return response({error: {code:'LEARNING_UNCONFIRMED', message:'词卡请求暂无法确认。'}}, 503);
  }
}
