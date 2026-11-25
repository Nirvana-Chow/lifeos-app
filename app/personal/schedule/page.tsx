import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {readPlatformPagePrincipal} from '../../../src/platform/runtime';
import {PrivacyBoundary} from '../../../src/personal-candidate/privacy';
import {validateId} from '../../../src/platform/domain';
import {PersonalCalendarPage} from '../../../src/calendar-candidate/personal-page';
export const dynamic='force-dynamic';
export const metadata={title:'LifeOS · 日程',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{record?:string}>}){
 let principal=null;try{principal=await readPlatformPagePrincipal(await headers());}catch{}if(!principal)redirect('/login');
 const {record}=await searchParams;
 let linkedRecordId:string|undefined;
 if(record!==undefined)try{linkedRecordId=validateId(record);}catch{}
 return <PrivacyBoundary><PersonalCalendarPage linkedRecordId={linkedRecordId}/></PrivacyBoundary>;
}
