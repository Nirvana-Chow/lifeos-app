import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {dirname,resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import type {PublicEntry} from '../src/platform/contracts.ts';
import {privateHrefs} from '../src/workbench/private-navigation.ts';
import * as fixture from './helpers/private-business-browser-fixture.ts';

test('missing private handoff fails before trust launch or body access',async()=>{
 let touched=false;
 await assert.rejects(fixture.withPrivateBrowserFixture(undefined,async()=>{touched=true;}),/BROWSER_PRIVATE_HANDOFF_UNAVAILABLE/);
 assert.equal(touched,false);
});
test('private capture registry pins every family route and the exact uploaded filenames',()=>{
 assert.equal(fixture.privateCaptureCases.length,96);
 const expected=new Set(fixture.privateCaptureCases.map(row=>row.name));assert.equal(expected.size,96);
 const workflow=readFileSync('.github/workflows/ci.yml','utf8');
 const uploaded=Array.from(workflow.matchAll(/owner-personal-browser-screenshots\/(\S+\.png)/g),m=>m[1]);
 assert.equal(uploaded.length,112);assert.equal(new Set(uploaded).size,112);
 assert.deepEqual(uploaded.filter(name=>name.startsWith('private-')).sort(),[...expected].sort());
 assert.deepEqual(Array.from(workflow.matchAll(/owner-recovery-browser-screenshots\/(\S+\.png)/g),m=>m[1]).sort(),['recovery-desktop.png','recovery-mobile.png','login-desktop.png','login-mobile.png','mfa-login-desktop.png','mfa-login-mobile.png'].sort());
});
test('capture scope refuses wrong routes state viewport theme names and credentials',()=>{
 const clean={name:'private-finance-360-dark.png',url:'https://review.example.test/personal/finance',width:360,theme:'dark',heading:'财务',dialog:0};
 assert.doesNotThrow(()=>fixture.assertPrivateCaptureScope(clean));
 for(const change of [{name:'../private-finance-360-dark.png'},{name:'private-unknown-360-dark.png'},{url:clean.url+'?mode=synthetic-review'},{url:clean.url+'#secret'},{url:'https://user:secret@review.example.test/personal/finance'},{url:'https://review.example.test:14443/personal/finance'},{url:'https://review.example.test/personal/finance/extra'},{width:390},{theme:'light'},{heading:'登录'},{dialog:1}])assert.throws(()=>fixture.assertPrivateCaptureScope({...clean,...change}),/PRIVATE_CAPTURE_DENIED/);
});
test('snapshot guard compares full original receipts and rejects fourth duplicate foreign and same-title private fields',()=>{
 const entries=[{id:'domain',draft:{title:'合成领域'}},{id:'project',draft:{title:'合成项目'}},{id:'todo',draft:{title:'合成待办'}}] as unknown as PublicEntry[];
 const clean={scope:'full-current-snapshot',truncated:false,total:3,items:entries};
 assert.doesNotThrow(()=>fixture.assertPrivateSnapshot(clean,entries));
 for(const change of [{truncated:true},{total:4},{items:[...entries,{id:'foreign'}]},{items:[entries[0],entries[0],entries[2]]},{items:[entries[0],entries[1],{...entries[2],privateBody:'private'}]}])assert.throws(()=>fixture.assertPrivateSnapshot({...clean,...change},entries),/PRIVATE_SNAPSHOT_DENIED/);
});
test('content guard admits exact approved source text and synthetic values and refuses unknown body or credentials',()=>{
 const clean={forbidden:0,values:[''],texts:['财务','未接入数据'],editable:[],recordIds:[]};
 assert.doesNotThrow(()=>fixture.assertPrivateCaptureContent(clean,new Set(['财务','未接入数据']),new Set(['']),[]));
 for(const change of [{forbidden:1},{values:['private']},{texts:['财务','private body']},{editable:['private']},{recordIds:['foreign']}])assert.throws(()=>fixture.assertPrivateCaptureContent({...clean,...change},new Set(['财务','未接入数据']),new Set(['']),[]),/PRIVATE_CAPTURE_DENIED/);
});
test('first-visible observations include checked preference and reject final-state-only or late repaired themes',()=>{
 const first={theme:'dark',scheme:'dark',checked:'dark',time:4};
 assert.doesNotThrow(()=>fixture.assertFirstVisibleTheme([first], 'dark','dark'));
 for(const observations of [[],[{...first,checked:'system'}],[{...first,theme:'light'},first],[{...first,scheme:'light'},first]])assert.throws(()=>fixture.assertFirstVisibleTheme(observations,'dark','dark'),/PRIVATE_FIRST_VISIBLE_THEME/);
});
test('appearance checks keep the first three Header palette frames and the first three visible control frames',()=>{
 const first={theme:'dark',scheme:'dark',checked:null,control:'hidden',time:4} as const;
 const palette=Array.from({length:3},(_,i)=>({...first,time:i+1}));
 const controls:fixture.FirstVisibleTheme[]=Array.from({length:3},(_,i)=>({...first,checked:'dark',control:'visible',time:i+10}));
 assert.doesNotThrow(()=>fixture.assertFirstVisibleAppearance(palette,controls,'dark','dark'));
 for(const [header,visible] of [[[],controls],[palette,[]],[palette.slice(1),controls],[palette,controls.slice(1)],[[{...first,theme:'light'},...palette.slice(1)],controls],[palette,[{...controls[0],checked:'system'},...controls.slice(1)]],[palette,[{...controls[0],control:'hidden'},...controls.slice(1)]],[palette,[{...controls[0],time:Number.NaN},...controls.slice(1)]]] as const){
  assert.throws(()=>fixture.assertFirstVisibleAppearance([...header],[...visible],'dark','dark'),/PRIVATE_FIRST_VISIBLE_THEME/);
 }
});
test('the passive init observer records early palette and control mistakes without waiting for repair',async()=>{
 for(const fault of ['none','palette','checked','missing-checked'] as const){
  let install!:()=>void;
  await fixture.observeFirstVisibleTheme({addInitScript:async(script:()=>void)=>{install=script;}} as never);
  const w={} as {__lifeosFirstVisible:fixture.FirstVisibleTheme[];__lifeosFirstVisibleControls:fixture.FirstVisibleTheme[]};
  let frame=0;const queued:Function[]=[];
  const label={getBoundingClientRect:()=>({width:44,height:44})};
  const radio={closest:()=>label,value:'dark'};
  const root={dataset:{lifeosTheme:'dark'}};
  const header={getBoundingClientRect:()=>({width:300,height:60}),querySelector:(selector:string)=>selector.endsWith(':checked')?(frame<3?null:frame===3&&fault==='missing-checked'?null:{value:frame===3&&fault==='checked'?'system':'dark'}):radio};
  const getComputedStyle=(node:unknown)=>({visibility:node===label&&frame<3?'hidden':'visible',colorScheme:root.dataset.lifeosTheme});
  new Function('window','document','getComputedStyle','performance','requestAnimationFrame',`(${install.toString()})()`)(w,{documentElement:root,querySelector:()=>header},getComputedStyle,{now:()=>frame*16},(fn:Function)=>queued.push(fn));
  while(queued.length&&frame<10){root.dataset.lifeosTheme=frame===0&&fault==='palette'?'light':'dark';queued.shift()!();frame++;}
  assert.equal(queued.length,0);assert.equal(w.__lifeosFirstVisible.length,3);assert.equal(w.__lifeosFirstVisibleControls.length,3);
  assert.deepEqual(w.__lifeosFirstVisible.map(item=>item.time),[0,16,32]);
  assert.deepEqual(w.__lifeosFirstVisibleControls.map(item=>item.time),[48,64,80]);
  if(fault==='none')assert.doesNotThrow(()=>fixture.assertFirstVisibleAppearance(w.__lifeosFirstVisible,w.__lifeosFirstVisibleControls,'dark','dark'));
  else assert.throws(()=>fixture.assertFirstVisibleAppearance(w.__lifeosFirstVisible,w.__lifeosFirstVisibleControls,'dark','dark'),/PRIVATE_FIRST_VISIBLE_THEME/);
 }
});
test('first-visible diagnostic projection limits output to finite enums and rounded relative times',()=>{
 const privateValue='private-secret-value';
 const projected=fixture.projectFirstVisibleDiagnostic(privateValue,[
  {theme:privateValue,scheme:'dark',checked:privateValue,control:privateValue,time:1.6,url:privateValue,timeOrigin:privateValue,input:privateValue,storage:privateValue,body:privateValue,cookie:privateValue},
  {theme:'light',scheme:privateValue,checked:'system',control:'visible',time:Number.NaN},
  {theme:'dark',scheme:'dark',checked:null,control:'hidden',time:Number.POSITIVE_INFINITY},
  {theme:'dark',scheme:'dark',checked:'dark',control:'visible',time:999},
 ],privateValue);
 assert.deepEqual(projected,{phase:'other',document:'unknown',frames:[
  {theme:'other',scheme:'dark',checked:'other',control:'other',timeMs:2},
  {theme:'light',scheme:'other',checked:'system',control:'visible'},
  {theme:'dark',scheme:'dark',checked:'missing',control:'hidden'},
 ]});
 assert.equal(JSON.stringify(projected).includes(privateValue),false);
 assert.equal(JSON.stringify(projected).includes('999'),false);
 assert.equal(JSON.stringify(projected).includes('NaN'),false);
 assert.equal(JSON.stringify(projected).includes('Infinity'),false);
 const outOfRange=fixture.projectFirstVisibleDiagnostic('initial-system',[
  {theme:'light',scheme:'light',checked:'system',control:'visible',time:180001},
  {theme:'light',scheme:'light',checked:'system',control:'visible',time:-1},
 ],'unknown');
 assert.deepEqual(outOfRange.frames,[
  {theme:'light',scheme:'light',checked:'system',control:'visible'},
  {theme:'light',scheme:'light',checked:'system',control:'visible'},
 ]);
});
test('independent destination literals cover the actual frozen map and source paths cannot expand',()=>{
 assert.deepEqual(Object.fromEntries(fixture.privateDestinations.map(([id,path])=>[id,path])),privateHrefs);
 const texts=fixture.captureSourceText();assert.equal(texts.has('财务'),true);assert.equal([...texts].some(text=>/ICP备/.test(text)),false);assert.equal(texts.has('待办'),true);assert.equal(texts.has('详情'),true);
 assert.throws(()=>fixture.captureSourceText(fixture.privateCaptureSources.map(path=>path==='src/ui-review/task-grid.tsx'?'src/ui-review/reui/data-grid.tsx':path)),/PRIVATE_CAPTURE_SOURCE_DENIED/);
 assert.throws(()=>fixture.assertPrivateCaptureContent({forbidden:0,values:[],texts:['unapproved grid body'],editable:[],recordIds:[]},texts,new Set(),[]),/PRIVATE_CAPTURE_DENIED/);
 assert.throws(()=>fixture.captureSourceText([...fixture.privateCaptureSources,'/private/body.txt']),/PRIVATE_CAPTURE_SOURCE_DENIED/);
});
test('private handoff rejects arbitrary records before any lifecycle IO',()=>{
 const handoff={origin:'https://review.example.test',ownerId:'personal-review-user',spaceId:'personal-review-space',sourceSha:'a'.repeat(40),cookies:[{name:'__Secure-lifeos-platform-candidate.session_token',value:'fixture-memory-only',domain:'review.example.test',path:'/',secure:true,httpOnly:true,sameSite:'Strict',expires:Date.now()/1000+60}],entries:[{id:'a'},{id:'b'},{id:'c'}]};
 assert.throws(()=>fixture.assertPrivateHandoff(handoff as never),/BROWSER_PRIVATE_HANDOFF_UNAVAILABLE/);
});

test('handoff admits only three exact synthetic receipts with structured safe timestamp metadata',()=>{
 const iso='2030-11-02T00:00:00.000Z',spaceId='personal-review-space';
 const domainId='00000000-0000-4000-8000-000000000001',projectId='00000000-0000-4000-8000-000000000002',todoId='00000000-0000-4000-8000-000000000003';
 const sourceId=(id:string)=>id.replace('8000','9000');
 const domain={id:domainId,sourceId:sourceId(domainId),revision:1},project={id:projectId,sourceId:sourceId(projectId),revision:1};
 const drafts=[{title:'合成浏览器领域',text:'隔离合成领域说明',occurredOn:null,disposition:'reference',personal:{type:'domain'}},{title:'合成浏览器项目',text:'隔离合成项目目标',occurredOn:null,disposition:'reference',personal:{type:'project',stage:'idea',purpose:null,nextStep:'',domain,topics:[]}},{title:'合成浏览器待办更正',notes:'仅用于隔离浏览器的合成更正内容',dueOn:'2030-11-03',status:'in_progress',personal:{project,domain,topics:[]}}];
 const types=['domain','project','todo'],ids=[domainId,projectId,todoId];
 const entries=drafts.map((draft,i)=>({id:ids[i],kind:i===2?'todo':'inbox',revision:1,createdAt:iso,updatedAt:iso,syncState:'draft',externalStatus:null,draft,source:{id:sourceId(ids[i]),system:'website',externalId:ids[i],version:1,asOf:iso,original:{marker:'personal-manual-v1',spaceId,type:types[i],input:{spaceId,confirmed:true,fields:i===2?{title:'合成浏览器待办',notes:'仅用于隔离浏览器的合成补充内容',dueOn:'2030-11-02',status:'open'}:Object.fromEntries(Object.entries(draft).filter(([key])=>key!=='disposition'))}}}}));
 const clean={origin:'https://review.example.test',ownerId:'personal-review-user',spaceId,sourceSha:'a'.repeat(40),cookies:[{name:'__Secure-lifeos-platform-candidate.session_token',value:'fixture-memory-only',domain:'review.example.test',path:'/',secure:true,httpOnly:true,sameSite:'Strict',expires:Date.now()/1000+60}],entries};
 assert.doesNotThrow(()=>fixture.assertPrivateHandoff(clean as never));
 const sessionCookie={...clean.cookies[0],expires:-1};
 assert.doesNotThrow(()=>fixture.assertPrivateHandoff({...clean,cookies:[sessionCookie]} as never));
 for(const change of [{expires:Number.NaN},{expires:Number.POSITIVE_INFINITY},{expires:Date.now()/1000-60},{expires:-2},{domain:'foreign.example.test'}])assert.throws(()=>fixture.assertPrivateHandoff({...clean,cookies:[{...clean.cookies[0],...change}]} as never),/BROWSER_PRIVATE_HANDOFF_UNAVAILABLE/);
 for(const change of [{createdAt:'private record body'},{updatedAt:'private@example.com'},{source:{...entries[0].source,asOf:'private body'}}]){const poisoned={...clean,entries:[{...entries[0],...change},entries[1],entries[2]]};assert.throws(()=>fixture.assertPrivateHandoff(poisoned as never),/BROWSER_PRIVATE_HANDOFF_UNAVAILABLE/);}
});

// Execute the actual components and local dependencies. Only CSS module loading
// is inert; React, TanStack and ReUI execute their real SSR paths.
function renderRealComponent(file:string,name:string,props:Record<string,unknown>){
 const native=createRequire(import.meta.url),cache=new Map<string,any>();
 function load(file:string):any{
  const path=resolve(file);if(cache.has(path))return cache.get(path);const m={exports:{} as any};cache.set(path,m.exports);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{fileName:path,compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',code)((key:string)=>{
   if(key.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_,name)=>String(name)})};
   if(!key.startsWith('.'))return native(key);
   const base=resolve(dirname(path),key),target=extname(base)?base:[base+'.tsx',base+'.ts',base].find(existsSync);assert.ok(target,'real local dependency '+key);return load(target);
  },m,m.exports);return m.exports;
 }
 return renderToStaticMarkup(React.createElement(load(file)[name],props));
}
test('real standalone journal SSR maps measurement to its personal surface and flow Header without requiring main',()=>{
 const html=renderRealComponent('src/personal-candidate/workspace.tsx','PersonalWorkspace',{initialType:'journal',returnHref:'/personal'});
 assert.match(html,/^<div[^>]*data-lifeos-surface="personal"/);assert.doesNotMatch(html,/<main\b/);assert.match(html,/<header[^>]*aria-label="日记导航"/);assert.match(html,/<h1>日记<\/h1>/);
 const policy=fixture.privatePresentationScope('standalone-editor');assert.equal(policy.content,'[data-lifeos-surface="personal"]');assert.equal(policy.header,'[data-lifeos-surface="personal"] header');
 assert.equal(fixture.privatePresentationScope('workspace').content,'main');assert.equal(fixture.privatePresentationScope('workspace',true).content,'dialog[open],[role="dialog"]');
 const flow={height:138,display:'flex',wrap:'wrap',gap:12,contained:true,childHeights:[70,44,44]};
 assert.doesNotThrow(()=>fixture.assertPrivateHeaderGeometry('standalone-editor',360,flow));
 assert.throws(()=>fixture.assertPrivateHeaderGeometry('workspace',1365,flow),/PRIVATE_HEADER_GEOMETRY/);
 for(const change of [{height:20},{height:300},{contained:false},{wrap:'nowrap'},{childHeights:[]}])assert.throws(()=>fixture.assertPrivateHeaderGeometry('standalone-editor',360,{...flow,...change}),/PRIVATE_HEADER_GEOMETRY/);
});
test('real RecordGrid SSR headers pass only the finite direct-adapter source capture guard',()=>{
 const html=renderRealComponent('src/ui-review/record-grid.tsx','RecordGrid',{rows:[],projection:'persistent'});
 assert.match(html,/data-record-grid="reui"/);
 const headers=Array.from(html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g),match=>match[1].replace(/<[^>]+>/g,'').trim());
 assert.ok(headers.includes('项目 / 待办'),'real direct adapter header must render');
 const texts=fixture.captureSourceText();
 assert.doesNotThrow(()=>fixture.assertPrivateCaptureContent({forbidden:0,values:[],texts:headers,editable:[],recordIds:[]},texts,new Set(),[]));
 assert.throws(()=>fixture.assertPrivateCaptureContent({forbidden:0,values:[],texts:[...headers,'项目 / 待办 private body'],editable:[],recordIds:[]},texts,new Set(),[]),/PRIVATE_CAPTURE_DENIED/);
 assert.throws(()=>fixture.captureSourceText([...fixture.privateCaptureSources,'src/ui-review/record-grid.module.css']),/PRIVATE_CAPTURE_SOURCE_DENIED/);
});
