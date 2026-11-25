import {OwnerPageReadUnavailable} from '../../../src/session-duration/guard';
import {personalLoginHref} from '../../../src/session-duration/client';
import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {readPlatformPagePrincipal} from '../../../src/platform/runtime';
import {PrivacyBoundary} from '../../../src/personal-candidate/privacy';
import {JournalRecordPage} from '../../../src/personal-journal/page';
export const dynamic='force-dynamic';
export const metadata={title:'LifeOS · 日记',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){let principal=null;try{principal=await readPlatformPagePrincipal(await headers(),{distinguishUnavailable:true});}catch{return <OwnerPageReadUnavailable/>;}if(!principal)redirect(personalLoginHref('/personal/journal',await searchParams));return <PrivacyBoundary><JournalRecordPage/></PrivacyBoundary>;}
