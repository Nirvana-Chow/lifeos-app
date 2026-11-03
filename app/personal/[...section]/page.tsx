import {headers} from 'next/headers';
import {redirect,notFound} from 'next/navigation';
import {readPlatformPagePrincipal} from '../../../src/platform/runtime';
import {resolvePrivateModule,privateHrefs} from '../../../src/workbench/private-navigation';
import {WorkbenchShell} from '../../../src/workbench/shell';
import {BasicWorkspace,DraftEditor} from '../../../src/workbench/draft-workspace';
import {DomainPage} from '../../../src/workbench/domain';
import {DataSettings} from '../../../src/workbench/settings';

export const dynamic='force-dynamic';
export const metadata={title:'LifeOS · 私人工作台',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{section:string[]}>}){
 let principal=null;
 try{principal=await readPlatformPagePrincipal(await headers());}catch{}
 if(!principal)redirect('/login');
 const module=resolvePrivateModule((await params).section);
 if(!module)notFound();
 let content;
 if(module.id==='database')content=<DataSettings surface="personal"/>;
 else if(module.id==='ai-settings')content=<div style={{padding:'var(--lo-content-padding)'}}><h1>AI 服务设置</h1><DraftEditor kind="ai"/></div>;
 else if(module.id==='records'||module.id==='search'||module.id==='schedule'||module.id==='finance'||module.id==='growth'||module.id==='articles'||module.id==='knowledge'||module.id==='health')content=<BasicWorkspace module={module.id} homeHref={privateHrefs.overview} dataHref={privateHrefs.database} recordsHref={privateHrefs.records}/>;
 else content=<DomainPage module={module} settingsHref={privateHrefs.settings} surface="personal"/>;
 return <WorkbenchShell surface="personal">{content}</WorkbenchShell>;
}
