import {buildSkillRelease} from '../../../../../../src/agent-api/skill-update-channel.ts';
export const runtime='nodejs';
export async function GET(_request:Request,context:{params:Promise<{digest:string}>}) {
  const release=buildSkillRelease();
  const manifest=JSON.parse(release.manifestBytes.toString());
  if((await context.params).digest!==manifest.archive.sha256+'.tar.gz')return new Response(null,{status:404,headers:{'Cache-Control':'no-store'}});
  return new Response(release.archive,{headers:{
    'Content-Type':'application/gzip','Cache-Control':'public, max-age=31536000, immutable',
    'Content-Disposition':'attachment; filename="lifeos-agent.tar.gz"','X-Content-Type-Options':'nosniff',
  }});
}
