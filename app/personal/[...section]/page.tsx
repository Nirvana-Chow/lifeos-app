import {headers} from 'next/headers';
import {redirect,notFound} from 'next/navigation';
import {readPlatformPagePrincipal} from '../../../src/platform/runtime';
import {resolvePrivateModule,privateHrefs} from '../../../src/workbench/private-navigation';
import {WorkbenchShell} from '../../../src/workbench/shell';
import {BasicWorkspace,DraftEditor} from '../../../src/workbench/draft-workspace';
import {DomainPage} from '../../../src/workbench/domain';
import {LifeOSWorkspace} from '../../../src/ui-review/workspace';
import {PrivacyBoundary} from '../../../src/personal-candidate/privacy';

export const dynamic='force-dynamic';
export const metadata={title:'LifeOS · 私人工作台',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{section:string[]}>}){
 let principal=null;
 try{principal=await readPlatformPagePrincipal(await headers());}catch{}
 if(!principal)redirect('/login');
 const module=resolvePrivateModule((await params).section);
 if(!module)notFound();
 if(module.id==='schedule'||module.id==='database'){
  const unavailablePage=module.id==='schedule'
   ? {title:'日历与日程',message:'日程尚未开放。'}
   : {title:'数据库与数据',message:'数据管理入口已收起。'};
  return <PrivacyBoundary><LifeOSWorkspace state={{status:'unknown'}} access={{authenticated:true,writable:null,loginAllowed:true}} unavailablePage={unavailablePage}/></PrivacyBoundary>;
 }
 let content;
 if(module.id==='ai-settings')content=<div style={{padding:'var(--lo-content-padding)'}}><h1>AI 服务设置</h1><DraftEditor kind="ai"/></div>;
 else if(module.id==='records'||module.id==='search'||module.id==='finance'||module.id==='growth'||module.id==='articles'||module.id==='knowledge'||module.id==='health')content=<BasicWorkspace module={module.id} homeHref={privateHrefs.overview} dataHref={privateHrefs.database} recordsHref={privateHrefs.records}/>;
 else content=<DomainPage module={module} settingsHref={privateHrefs.settings} surface="personal"/>;
 return <WorkbenchShell surface="personal">{content}</WorkbenchShell>;
}
