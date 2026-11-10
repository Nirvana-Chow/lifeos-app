import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {categories,listRecipes} from '../../../src/cooking/catalog';
import {CookingWorkspace} from '../../../src/cooking/workspace';
import {PrivacyBoundary} from '../../../src/personal-candidate/privacy';
import {readPlatformPagePrincipal} from '../../../src/platform/runtime';

export const dynamic='force-dynamic';
export const metadata={title:'LifeOS · 做饭',robots:{index:false,follow:false}};

export default async function Page(){
 const principal=await readPlatformPagePrincipal(await headers()).catch(()=>null);
 if(!principal)redirect('/login');
 return <PrivacyBoundary><CookingWorkspace recipes={listRecipes()} categories={categories}/></PrivacyBoundary>;
}
