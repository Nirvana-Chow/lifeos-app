import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {PersonalPage} from '../../../src/personal-candidate/personal-page';
import {LearningWorkspace} from '../../../src/personal-learning/workspace';
import {readPlatformPagePrincipal} from '../../../src/platform/runtime';

export const dynamic = 'force-dynamic';
export const metadata = {title:'LifeOS · 学习', robots:{index:false, follow:false}};

export default async function Page() {
  if (!await readPlatformPagePrincipal(await headers()).catch(() => null)) redirect('/login');
  return <PersonalPage title="学习" initialPage="overview" wide><LearningWorkspace/></PersonalPage>;
}
