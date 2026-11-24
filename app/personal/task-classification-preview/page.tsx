import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {readPlatformPagePrincipal} from '../../../src/platform/runtime';
import {TaskClassificationPreview} from '../../../src/personal-candidate/task-classification-preview';

export const dynamic = 'force-dynamic';
export const metadata = {title: 'LifeOS · 待办分类预览', robots: {index: false, follow: false}};

export default async function Page() {
  const principal = await readPlatformPagePrincipal(await headers()).catch(() => null);
  if (!principal) redirect('/login');
  return <TaskClassificationPreview/>;
}
