import {buildSkillRelease} from '../../../../../src/agent-api/skill-update-channel.ts';
export const dynamic='force-static';
export const runtime='nodejs';
// The fixed HTTPS publisher is the authorization root for documentation updates.
// No cookies, credentials, owner configuration or private source enters this route.
export function GET() {
  return new Response(buildSkillRelease().manifestBytes,{headers:{
    'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  }});
}
