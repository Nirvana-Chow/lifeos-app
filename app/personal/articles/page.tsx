import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {readPlatformConfig} from '../../../src/platform/config';
import {readPersonalConfig} from '../../../src/personal-candidate/config';
import {BasicWorkspace} from '../../../src/workbench/draft-workspace';
import {privateHrefs} from '../../../src/workbench/private-navigation';
import {WorkbenchShell} from '../../../src/workbench/shell';
import {readPlatformPagePrincipal} from '../../../src/platform/runtime';
import {PrivacyBoundary} from '../../../src/personal-candidate/privacy';
import {ArticleWorkspace} from '../../../src/personal-article/workspace';

export const dynamic='force-dynamic';
export const metadata={title:'LifeOS · 文章',robots:{index:false,follow:false}};

export default async function Page(){
  let principal=null;
  try{principal=await readPlatformPagePrincipal(await headers());}catch{}
  if(!principal)redirect('/login');
  const platform=readPlatformConfig(process.env);
  const personal=platform?readPersonalConfig(process.env,platform):null;
  if(personal?.articleEnabled===true)return <PrivacyBoundary><ArticleWorkspace/></PrivacyBoundary>;
  return <WorkbenchShell surface="personal">
    <BasicWorkspace module="articles" homeHref={privateHrefs.overview} dataHref={privateHrefs.database} recordsHref={privateHrefs.records}/>
  </WorkbenchShell>;
}
