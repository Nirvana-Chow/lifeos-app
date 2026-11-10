import {headers} from 'next/headers';
import {notFound,redirect} from 'next/navigation';
import {categories,getRecipe} from '../../../../src/cooking/catalog';
import {CookingRecipe} from '../../../../src/cooking/detail';
import {PrivacyBoundary} from '../../../../src/personal-candidate/privacy';
import {readPlatformPagePrincipal} from '../../../../src/platform/runtime';

export const dynamic='force-dynamic';
export const metadata={title:'LifeOS · 菜谱',robots:{index:false,follow:false}};

export default async function Page({params}:{params:Promise<{id:string}>}){
 const principal=await readPlatformPagePrincipal(await headers()).catch(()=>null);
 if(!principal)redirect('/login');
 const recipe=getRecipe((await params).id);
 if(!recipe)notFound();
 const category=categories.find(entry=>entry.id===recipe.category);
 if(!category)notFound();
 return <PrivacyBoundary><CookingRecipe recipe={recipe} categoryLabel={category.label}/></PrivacyBoundary>;
}
