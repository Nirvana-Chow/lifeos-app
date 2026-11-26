import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {readPlatformPagePrincipal} from '../../../src/platform/runtime';
import {PersonalPage} from '../../../src/personal-candidate/personal-page';
import {FileIndexPanel} from '../../../src/personal-file-index/panel';

export const dynamic = 'force-dynamic';
export const metadata = {title: 'LifeOS · 文件地图', robots: {index: false, follow: false}};

export default async function Page({searchParams}: {searchParams: Promise<{id?: string}>}) {
  let principal = null;
  try { principal = await readPlatformPagePrincipal(await headers()); } catch {}
  if (!principal) redirect('/login');
  const {id} = await searchParams;
  return <PersonalPage title="文件地图" initialPage="projects" wide><FileIndexPanel initialId={typeof id === 'string' ? id : undefined}/></PersonalPage>;
}
