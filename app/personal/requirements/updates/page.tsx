import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {readPlatformPagePrincipal} from '../../../../src/platform/runtime';
import {RequirementSupportFrame} from '../../../../src/ui-review/requirement-support-frame';
import {RequirementUpdates} from '../../../../src/ui-review/requirement-updates';
export const dynamic='force-dynamic';
export const metadata={title:'LifeOS · 更新记录',robots:{index:false,follow:false}};
export default async function Page(){let principal=null;try{principal=await readPlatformPagePrincipal(await headers());}catch{}if(!principal)redirect('/login');return <RequirementSupportFrame title="更新记录"><RequirementUpdates/></RequirementSupportFrame>;}
