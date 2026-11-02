import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as clientModule from '../src/records-workbench/client.ts';
import * as readState from '../src/records-workbench/read-state.ts';
import * as linkFields from '../src/records-workbench/project-links.ts';
import type {RecordEntry,ProjectLink,ProjectRecapResponse} from '../src/records-candidate/contracts.ts';
const id='11111111-1111-4111-8111-111111111111',sourceId='22222222-2222-4222-8222-222222222222',linkedId='33333333-3333-4333-8333-333333333333',linkedSource='44444444-4444-4444-8444-444444444444',owner='synthetic-links-ui-owner',now='2026-10-24T00:00:00.000Z';
const pin:ProjectLink={type:'todo',id:linkedId,sourceId:linkedSource,revision:1},candidate={link:pin,title:'Synthetic source sentinel',summary:'Synthetic summary',updatedAt:now};
function entry():RecordEntry{const fields={title:'Synthetic project',text:'Synthetic body',occurredOn:null,record:{type:'project' as const,syntheticOnly:true as const,stage:'active' as const,nextStep:null,completion:{selfReported:true as const,status:'not-complete' as const,evidence:null},testing:{manuallyRecorded:true as const,outcome:'not-run' as const,evidence:null},review:{decision:'pending' as const,evidence:null},links:[pin]}};return {id,kind:'inbox',draft:{...fields,disposition:'reference'},source:{id:sourceId,system:'website',externalId:id,version:1,asOf:now,original:{...structuredClone(fields),disposition:'reference'}},revision:1,createdAt:now,updatedAt:now,syncState:'draft',externalStatus:null};}
function recap():ProjectRecapResponse{return {project:entry(),links:[{link:pin,status:'current',current:candidate}],counts:{total:1,current:1,updated:0,unavailable:0,todo:1,resource:0,article:0},reviewApplicable:false,reviewApplicability:'pending',observedAt:now,readOnly:true,aiGenerated:false,snapshotConsistency:'owner-snapshot',freshness:'refresh-to-check',dataStatus:'isolated-test-drafts',syntheticIncluded:true};}
type Node={type:unknown;props:Record<string,any>};
function text(node:any):string{if(node===null||node===undefined||typeof node==='boolean')return '';if(Array.isArray(node))return node.map(text).join('');if(typeof node!=='object')return String(node);return text(node.props?.children);}
function find(node:any,predicate:(node:Node)=>boolean):Node|undefined{if(!node||typeof node!=='object')return;if(Array.isArray(node)){for(const child of node){const found=find(child,predicate);if(found)return found;}return;}if(predicate(node))return node;return find(node.props?.children,predicate);}
/** Evaluates the real TSX with deterministic hook/event stubs, without browser/DOM. */
function harness(){let cursor=0;const values:any[]=[],effects=new Map<number,{run:()=>void|(()=>void);deps:any[];cleanup?:()=>void;pending:boolean}>();
 const react={useRef(value:any){const index=cursor++;return values[index]??(values[index]={current:value});},useState(initial:any){const index=cursor++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return [values[index],(next:any)=>{values[index]=typeof next==='function'?next(values[index]):next;}];},useEffect(run:()=>void|(()=>void),deps:any[]){const index=cursor++,prior=effects.get(index);if(!prior||deps.some((value,at)=>value!==prior.deps[at]))effects.set(index,{run,deps,cleanup:prior?.cleanup,pending:true});}};
 const jsx={jsx:(type:unknown,props:Record<string,any>)=>({type,props}),jsxs:(type:unknown,props:Record<string,any>)=>({type,props}),Fragment:'fragment'},module={exports:{} as Record<string,(props:any)=>Node>};
 const source=readFileSync(new URL('../src/records-workbench/project-links-view.tsx',import.meta.url),'utf8'),code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const imports:Record<string,unknown>={react,'react/jsx-runtime':jsx,'./client':clientModule,'./read-state':readState,'./project-links.ts':linkFields,'./styles.module.css':{default:{}}};
 new Function('require','module','exports',code)((path:string)=>{if(!(path in imports))throw Error('Unexpected import '+path);return imports[path];},module,module.exports);
 return {render(name:string,props:any){cursor=0;const tree=module.exports[name](props);for(const effect of effects.values())if(effect.pending){effect.cleanup?.();effect.cleanup=effect.run()||undefined;effect.pending=false;}return tree;},strictReplay(){for(const effect of effects.values())effect.cleanup?.();for(const effect of effects.values())effect.cleanup=effect.run()||undefined;},dispose(){for(const effect of effects.values())effect.cleanup?.();}};
}
const flush=async()=>{for(let at=0;at<8;at++)await new Promise<void>(resolve=>setImmediate(resolve));};
function client(){return new clientModule.RecordsClient(async input=>String(input).endsWith('/auth/get-session')?Response.json({user:{id:owner},session:{userId:owner}}):String(input).includes('/recap')?Response.json(recap()):Response.json({items:[candidate],limit:50,truncated:false,observedAt:now,dataStatus:'isolated-test-drafts',syntheticIncluded:true}));}

test('project candidate search remains live after a StrictMode effect cleanup/setup cycle',async()=>{
 const h=harness(),props={links:[],onChange(){},disabled:false,client:client(),ownerId:owner,onAccessIssue(cause:unknown){throw cause;}};h.render('ProjectLinksEditor',props);h.strictReplay();const tree=h.render('ProjectLinksEditor',props);find(tree,node=>node.type==='button'&&text(node)==='搜索来源')!.props.onClick();await flush();assert.match(text(h.render('ProjectLinksEditor',props)),/Synthetic source sentinel/);h.dispose();
});

test('project recap reads remain live after a StrictMode effect cleanup/setup cycle',async()=>{
 const h=harness(),props={entry:entry(),client:client(),ownerId:owner,onAccessIssue(cause:unknown){throw cause;},onReloadProject(){}};h.render('ProjectLinksRecap',props);h.strictReplay();await flush();assert.match(text(h.render('ProjectLinksRecap',props)),/Synthetic source sentinel/);h.dispose();
});

test('obsolete candidate identity failures conceal a newer result and notify the parent',async()=>{
 let finish!:(response:Response)=>void,calls=0,blocked=0;const transport:typeof fetch=async input=>{if(String(input).endsWith('/auth/get-session'))return Response.json({user:{id:owner},session:{userId:owner}});if(++calls===1)return new Promise<Response>(resolve=>{finish=resolve;});return Response.json({items:[candidate],limit:50,truncated:false,observedAt:now,dataStatus:'isolated-test-drafts',syntheticIncluded:true});};
 const h=harness(),props={links:[],onChange(){},disabled:false,client:new clientModule.RecordsClient(transport),ownerId:owner,onAccessIssue(){blocked++;}};h.render('ProjectLinksEditor',props);let tree=h.render('ProjectLinksEditor',props);find(tree,node=>node.type==='button'&&text(node)==='搜索来源')!.props.onClick();await flush();tree=h.render('ProjectLinksEditor',props);find(tree,node=>node.type==='input')!.props.onChange({target:{value:'new query'}});tree=h.render('ProjectLinksEditor',props);find(tree,node=>node.type==='button'&&text(node)==='搜索来源')!.props.onClick();await flush();assert.match(text(h.render('ProjectLinksEditor',props)),/Synthetic source sentinel/);
 finish(Response.json({error:{code:'LOGIN_REQUIRED',message:'safe'}},{status:401}));await flush();assert.equal(blocked,1);assert.doesNotMatch(text(h.render('ProjectLinksEditor',props)),/Synthetic source sentinel/);h.dispose();
});

test('obsolete recap identity failures conceal the currently displayed snapshot',async()=>{
 let finish!:(response:Response)=>void,calls=0,blocked=0;const transport:typeof fetch=async input=>{if(String(input).endsWith('/auth/get-session'))return Response.json({user:{id:owner},session:{userId:owner}});if(++calls===1)return new Promise<Response>(resolve=>{finish=resolve;});return Response.json(recap());};
 const h=harness(),props={entry:entry(),client:new clientModule.RecordsClient(transport),ownerId:owner,onAccessIssue(){blocked++;},onReloadProject(){}};h.render('ProjectLinksRecap',props);await flush();h.strictReplay();await flush();assert.match(text(h.render('ProjectLinksRecap',props)),/Synthetic source sentinel/);finish(Response.json({error:{code:'LOGIN_REQUIRED',message:'safe'}},{status:401}));await flush();assert.equal(blocked,1);assert.doesNotMatch(text(h.render('ProjectLinksRecap',props)),/Synthetic source sentinel/);h.dispose();
});
