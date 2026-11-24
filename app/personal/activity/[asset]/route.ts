import { activityAsset } from '../../../../src/personal-daily/activity-review/document';

export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ asset: string }> }): Promise<Response> {
  return activityAsset((await context.params).asset);
}
