import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {readPlatformPagePrincipal} from '../../../src/platform/runtime';
import {PrivacyBoundary} from '../../../src/personal-candidate/privacy';
import {PersonalRecordPage} from '../../../src/personal-candidate/record-page';
export const dynamic='force-dynamic';
export const metadata={title:'LifeOS · 日记',robots:{index:false,follow:false}};
export default async function Page(){let principal=null;try{principal=await readPlatformPagePrincipal(await headers());}catch{}if(!principal)redirect('/login');return <PrivacyBoundary><PersonalRecordPage type="journal"/></PrivacyBoundary>;}
