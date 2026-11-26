import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {readPlatformPagePrincipal} from '../../../src/platform/runtime';
import {HostedBusinessRecordPage} from '../../../src/personal-candidate/record-page';
export const dynamic='force-dynamic';
export const metadata={title:'LifeOS · 书影音',robots:{index:false,follow:false}};
export default async function Page(){let principal=null;try{principal=await readPlatformPagePrincipal(await headers());}catch{}if(!principal)redirect('/login');return <HostedBusinessRecordPage type="media"/>;}
