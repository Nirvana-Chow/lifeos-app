import { activityDocument } from '../../../src/personal-daily/activity-review/document';
import { handlePlatformRequest, readPlatformPagePrincipal } from '../../../src/platform/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request): Promise<Response> {
  return activityDocument(request, readPlatformPagePrincipal, handlePlatformRequest);
}
