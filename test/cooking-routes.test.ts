import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import {ownerModules} from '../src/ui-review/owner-modules.ts';

const recipe={id:'0123456789abcdef',name:'合成菜谱',category:'vegetable_dish',difficulty:1,ingredients:['合成食材'],sourceUrl:'https://example.invalid',sections:[]};
const scope=JSON.stringify(['fixture-owner','fixture-space']);
const status={scope:'personal-manual-candidate',storageVerified:true,ownerId:'fixture-owner',spaceId:'fixture-space'};
const routes=['app/personal/cooking/page.tsx','app/personal/cooking/[id]/page.tsx'];
function loadRoute(path:string,identity:unknown) {
 const mod={exports:{} as {default:(input:{params:Promise<{id:string}>})=>Promise<any>}};
 const catalogReads:string[]=[];
 const jsx=(type:unknown,props:unknown)=>({type,props});
 const imports:Record<string,unknown>={
  'react/jsx-runtime':{jsx,jsxs:jsx},
  'next/headers':{headers:async()=>new Headers()},
  'next/navigation':{redirect:(url:string)=>{throw Error('redirect:'+url);},notFound:()=>{throw Error('not found');}},
  runtime:{readPlatformPagePrincipal:async()=>{if(identity instanceof Error)throw identity;return identity;}},
  frame:{CookingFrame:'frame'},
  catalog:{categories:[{id:recipe.category,label:'素菜'}],listRecipes:()=>{catalogReads.push('all');return [recipe];},getRecipe:(id:string)=>{catalogReads.push(id);return id===recipe.id?recipe:undefined;}},
  workspace:{CookingWorkspace:'workspace'},detail:{CookingRecipe:'recipe'},
 };
 const output=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('require','module','exports',output)((name:string)=>{
  const key=name.startsWith('.')?name.split('/').at(-1)!:name;
  assert.ok(key in imports,'Unexpected import '+name);return imports[key];
 },mod,mod.exports);
 return {page:(id=recipe.id)=>mod.exports.default({params:Promise.resolve({id})}),catalogReads};
}

test('cooking entry is available to the verified owner scope only',()=>{
 assert.deepEqual(ownerModules(status,scope).find(link=>link.id==='cooking'),{id:'cooking',label:'做饭',href:'/personal/cooking'});
 for(const state of [null,{...status,storageVerified:false},{...status,spaceId:'other-space'}])
  assert.equal(ownerModules(state,scope).some(link=>link.href==='/personal/cooking'),false);
});

test('both cooking URLs require verified access before looking up catalog data',async()=>{
 for(const path of routes)for(const identity of [null,Error('owner service unavailable')]){
  const {page,catalogReads}=loadRoute(path,identity);
  await assert.rejects(page(),/redirect:\/login/);
  assert.deepEqual(catalogReads,[]);
 }
});

test('owner can open catalog and direct details; unknown IDs fail closed',async()=>{
 const list=loadRoute(routes[0]!,{ownerId:'fixture-owner'});
 const catalog=await list.page();
 assert.equal(catalog.type,'frame');
 assert.equal(catalog.props.children.type,'workspace');
 assert.deepEqual(list.catalogReads,['all']);
 const detail=loadRoute(routes[1]!,{ownerId:'fixture-owner'});
 const selected=await detail.page();
 assert.equal(selected.type,'frame');
 assert.deepEqual(selected.props.children.props,{recipe,categoryLabel:'素菜'});
 await assert.rejects(detail.page('0000000000000000'),/not found/);
});
