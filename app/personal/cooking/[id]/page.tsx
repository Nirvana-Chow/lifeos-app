import {headers} from 'next/headers';
import {notFound,redirect} from 'next/navigation';
import {categories,getRecipe} from '../../../../src/cooking/catalog';
import {CookingRecipe} from '../../../../src/cooking/detail';
import {CookingFrame} from '../../../../src/cooking/frame';
import {readPlatformPagePrincipal} from '../../../../src/platform/runtime';
import {readRecipeBrowse,recipeBrowseQuery} from '../../../../src/cooking/browse-location';

export const dynamic='force-dynamic';
export const metadata={title:'LifeOS · 菜谱',robots:{index:false,follow:false}};

export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams?:Promise<Record<string,string|string[]|undefined>>}){
 const principal=await readPlatformPagePrincipal(await headers()).catch(()=>null);
 if(!principal)redirect('/login');
 const recipe=getRecipe((await params).id);
 if(!recipe)notFound();
 const category=categories.find(entry=>entry.id===recipe.category);
 if(!category)notFound();
 const query=new URLSearchParams();
 for(const [key,value] of Object.entries(await searchParams??{}))if(typeof value==='string')query.set(key,value);
 const browse=readRecipeBrowse(query,categories);
 const backHref=browse?'/personal/cooking?'+recipeBrowseQuery(browse):'/personal/cooking';
 return <CookingFrame title={recipe.name}><CookingRecipe recipe={recipe} categoryLabel={category.label} backHref={backHref}/></CookingFrame>;
}
