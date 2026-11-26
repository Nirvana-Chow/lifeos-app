import {getPlatformLearningRuntime} from '../platform/runtime.ts';
import type {LearningRuntime} from './http.ts';

export async function readLearningRuntime(_request: Request): Promise<LearningRuntime | null> {
  return getPlatformLearningRuntime();
}
