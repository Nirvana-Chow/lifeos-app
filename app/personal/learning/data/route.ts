import {handleLearningRequest} from '../../../../src/personal-learning/http';
import {readLearningRuntime} from '../../../../src/personal-learning/runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
async function handle(request: Request) {
  return handleLearningRequest(request, await readLearningRuntime(request).catch(() => null));
}
export {handle as GET, handle as POST};
