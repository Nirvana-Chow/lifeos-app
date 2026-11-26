import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {PrivacyBoundary} from '../../../src/personal-candidate/privacy';
import {readPlatformPagePrincipal} from '../../../src/platform/runtime';
import {projectReviewId} from '../../../src/personal-reports/report';
import {ProjectReports} from '../../../src/personal-reports/project-reports';
import {WorkbenchShell} from '../../../src/workbench/shell';

export const dynamic = 'force-dynamic';
export const metadata = {title: '项目回顾 · LifeOS', robots: {index: false, follow: false}};

export default async function Page({searchParams}:{searchParams:Promise<{project?:string|string[]}>}) {
  const requestHeaders = await headers();
  const principal = await readPlatformPagePrincipal(requestHeaders).catch(() => null);
  if (!principal) redirect('/login');
  const requested = projectReviewId((await searchParams).project);
  return <PrivacyBoundary><WorkbenchShell surface="personal"><ProjectReports initialProject={requested}/></WorkbenchShell></PrivacyBoundary>;
}
