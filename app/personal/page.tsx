import {OwnerPageReadUnavailable} from '../../src/session-duration/guard';
import {personalLoginHref} from '../../src/session-duration/client';
import {keyManagementFlag} from '../../src/agent-api/key-management-config';
import{headers}from'next/headers';import{redirect}from'next/navigation';
import{readPlatformPagePrincipal,readPlatformPasswordCapability}from'../../src/platform/runtime';
import{LivePersonalWorkspace}from'../../src/personal-candidate/live-workspace';
import{readWorkspaceLocation}from'../../src/workbench/private-navigation';
export const dynamic='force-dynamic';
export const metadata={title:'LifeOS · 本人空间',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{page?:string;create?:string;modal?:string;panel?:string;planId?:string}>}){let principal=null;try{principal=await readPlatformPagePrincipal(await headers(),{distinguishUnavailable:true});}catch{return <OwnerPageReadUnavailable/>;}const q=await searchParams;if(!principal)redirect(personalLoginHref('/personal',q));const location=readWorkspaceLocation(q),initialPage=location.page;return <LivePersonalWorkspace showApiKeys={process.env[keyManagementFlag]==='1'} passwordEnabled={await readPlatformPasswordCapability()} initialModal={location.modal} initialSettingsPanel={location.panel} initialClassificationPlanId={location.planId} initialPage={initialPage} initialCreateTask={q.create==='todo'&&initialPage!=='requirements'&&initialPage!=='settings'&&!location.modal}/>;}
