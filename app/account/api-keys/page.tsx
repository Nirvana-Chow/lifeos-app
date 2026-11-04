import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {AccountApiKeys} from '../../../src/personal-candidate/account-api-keys';
import {PersonalPage} from '../../../src/personal-candidate/personal-page';
import {readPlatformMfaState} from '../../../src/platform/runtime';

export const dynamic = 'force-dynamic';
export const metadata = {title: 'LifeOS · API 密钥', robots: {index: false, follow: false}};

export default async function Page() {
  const state = await readPlatformMfaState(await headers());
  if (state.kind === 'anonymous') redirect('/login');
  if (state.kind !== 'ready') redirect('/account/mfa');
  return <PersonalPage title="API 密钥"><AccountApiKeys embedded/></PersonalPage>;
}
