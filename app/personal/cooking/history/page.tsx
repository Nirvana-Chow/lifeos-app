import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { getRecipe } from '../../../../src/cooking/catalog';
import { CookingHistoryPage } from '../../../../src/cooking/log-workbench';
import { readPlatformPagePrincipal } from '../../../../src/platform/runtime';

export const dynamic = 'force-dynamic';
export const metadata = { title:'LifeOS · 做饭历史', robots:{index:false,follow:false} };

export default async function Page({ searchParams }: {searchParams: Promise<{recipe?: string | string[]}>}) {
  const principal = await readPlatformPagePrincipal(await headers()).catch(() => null);
  if (!principal) redirect('/login');
  const { recipe: recipeId } = await searchParams;
  const recipe = typeof recipeId === 'string' ? getRecipe(recipeId) : undefined;
  if (recipeId !== undefined && !recipe) notFound();
  return <CookingHistoryPage recipe={recipe ? {id:recipe.id,name:recipe.name,sourceUrl:recipe.sourceUrl} : null} />;
}
