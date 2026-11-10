import {headers} from 'next/headers';
import {readPlatformPagePrincipal} from '../../../src/platform/runtime';
import {storageReviewResponse} from './response';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return storageReviewResponse(async () => readPlatformPagePrincipal(await headers()));
}
