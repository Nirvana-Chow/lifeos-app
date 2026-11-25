import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {PersonalPage} from '../../../src/personal-candidate/personal-page';
import {readPlatformPagePrincipal} from '../../../src/platform/runtime';
import {DevelopmentProjects} from '../../../src/ui-review/development-projects';

export const dynamic = 'force-dynamic';
export const metadata = {title:'LifeOS · 开发项目', robots:{index:false, follow:false}};

export default async function Page() {
  let principal = null;
  try {
    principal = await readPlatformPagePrincipal(await headers());
  } catch {
    // The existing owner check fails closed.
  }
  if (!principal) redirect('/login');
  return <PersonalPage title="开发项目" initialPage="overview" wide>
    <DevelopmentProjects />
  </PersonalPage>;
}
