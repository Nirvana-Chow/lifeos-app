import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {readPlatformPagePrincipal} from '../platform/runtime';
import {StorageReviewBody} from './workspace-body';

export default async function StorageReviewWorkspaceEntry() {
  const principal = await readPlatformPagePrincipal(await headers()).catch(() => null);
  if (!principal) redirect('/login');
  return <StorageReviewBody/>;
}
