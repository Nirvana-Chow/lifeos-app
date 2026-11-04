import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {readPlatformMfaState} from '../../../src/platform/runtime';

export const dynamic = 'force-dynamic';
export const metadata = {title: 'LifeOS · API 密钥', robots: {index: false, follow: false}};

export default async function Page() {
  const state = await readPlatformMfaState(await headers());
  if (state.kind === 'anonymous') redirect('/login');
  if (state.kind !== 'ready') redirect('/account/mfa');
  redirect('/personal?modal=settings&panel=api-keys');
}
