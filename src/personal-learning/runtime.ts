import type {LearningRuntime} from './http.ts';

/** Integration seam for the existing platform writer. No storage or grant is enabled by this slice. */
export async function readLearningRuntime(_request: Request): Promise<LearningRuntime | null> {
  return null;
}
