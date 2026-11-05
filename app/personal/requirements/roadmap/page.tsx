import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {readPlatformPagePrincipal} from '../../../../src/platform/runtime';
import {RequirementSupportFrame} from '../../../../src/ui-review/requirement-support-frame';
import {RequirementRoadmap} from '../../../../src/ui-review/requirement-roadmap';
export const dynamic='force-dynamic';
export const metadata={title:'LifeOS · 阶段路线图',robots:{index:false,follow:false}};
export default async function Page(){let principal=null;try{principal=await readPlatformPagePrincipal(await headers());}catch{}if(!principal)redirect('/login');return <RequirementSupportFrame title="阶段路线图"><RequirementRoadmap/></RequirementSupportFrame>;}
