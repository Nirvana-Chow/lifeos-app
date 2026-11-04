import {buildSkillArtifact} from '../../../src/agent-api/skill-artifact.ts';

export const dynamic = 'force-static';
export const runtime = 'nodejs';

// Exact public artifact only. No request, cookies, identity or runtime config.
export function GET() {
  return new Response(buildSkillArtifact(),{headers:{
    'Content-Type':'application/gzip',
    'Content-Disposition':'attachment; filename="lifeos-agent.tar.gz"',
    'Cache-Control':'public, max-age=0, must-revalidate',
    'X-Content-Type-Options':'nosniff',
  }});
}
