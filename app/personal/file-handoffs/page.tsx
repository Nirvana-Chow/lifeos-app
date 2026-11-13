import {headers} from 'next/headers';import {redirect} from 'next/navigation';
import {readPlatformPagePrincipal} from '../../../src/platform/runtime';
import {RequirementSupportFrame} from '../../../src/ui-review/requirement-support-frame';
import {FileHandoffPanel} from '../../../src/file-handoff/panel';
import {fileIdSchema} from '../../../src/file-handoff/public';
export const dynamic='force-dynamic';export const metadata={title:'LifeOS · 文件交接',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{id?:string}>}){
 let principal=null;try{principal=await readPlatformPagePrincipal(await headers());}catch{}if(!principal)redirect('/login');
 const value=(await searchParams).id,id=fileIdSchema.safeParse(value);return <RequirementSupportFrame title="文件交接"><FileHandoffPanel initialId={id.success?id.data:undefined}/></RequirementSupportFrame>;
}
