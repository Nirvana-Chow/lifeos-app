import test from 'node:test';
import assert from 'node:assert/strict';
import type {AreaRow,ProjectRow} from '../src/ui-review/contract.ts';
import type {OwnerModuleLink} from '../src/ui-review/owner-modules.ts';

import * as hierarchy from '../src/ui-review/workspace-hierarchy.ts';
const project=(id:string,area:ProjectRow['area'],stage='active'):ProjectRow=>({id,title:id,revision:1,area,stage,nextStep:'真实下一步'});

test('navigation groups only supplied authorized links without dropping or duplicating existing destinations',()=>{
 assert.equal(typeof hierarchy.groupWorkspaceModules,'function','grouped workspace navigation is required');
 const links:OwnerModuleLink[]=[{id:'journal',label:'日记',href:'/personal/journal'},{id:'calendar',label:'日程',href:'/personal/schedule'},{id:'finance',label:'财务',href:'/personal/finance'}];
 assert.deepEqual(hierarchy.groupWorkspaceModules(links).map(group=>[group.label,group.links.map(link=>link.id)]),[['安排与推进',['calendar']],['生活记录',['journal']],['长期积累',['finance']],['资料与工具',[]]]);
 assert.deepEqual(hierarchy.groupWorkspaceModules([]).flatMap(group=>group.links),[]);
 assert.deepEqual(hierarchy.groupWorkspaceModules(links).flatMap(group=>group.links).map(link=>link.href).sort(),['/personal/finance','/personal/journal','/personal/schedule']);
});

test('domain overview associates active projects by stable identity and retains unassigned and unloaded references',()=>{
 assert.equal(typeof hierarchy.overviewDomains,'function','domain project overview is required');
 const areas:AreaRow[]=[{id:'a',title:'相同名称',revision:1},{id:'b',title:'相同名称',revision:1}];
 const projects=[project('first',{id:'b',title:'相同名称'}),project('second',null),project('third',{id:'missing',title:'未加载领域'}),project('planned',{id:'a',title:'相同名称'},'planned'),project('done',null,'completed')];
 const result=hierarchy.overviewDomains(areas,projects);
 assert.deepEqual(result.map(group=>[group.id,group.title,group.projects.map(row=>row.id)]),[['a','相同名称',[]],['b','相同名称',['first']],['missing','未加载领域',['third']],[null,'未关联领域',['second']]]);
 assert.equal(result[2].loaded,false);
 assert.equal(result[1].projects[0].nextStep,'真实下一步');
 assert.equal(projects.length,5);
 assert.deepEqual(hierarchy.overviewDomains([],[]),[]);
});

test('search is discoverable in the authorized navigation grouping',()=>{
 const search={id:'search',label:'搜索本人记录',href:'/personal/search'} as OwnerModuleLink;
 assert.deepEqual(hierarchy.groupWorkspaceModules([search]).flatMap(group=>group.links),[search]);
});

test('storage review is discoverable in tools without dropping other authorized modules',()=>{
 const link={id:'storage-review',label:'存储审核',href:'/personal/storage-review'} as OwnerModuleLink;
 assert.deepEqual(hierarchy.groupWorkspaceModules([link]).filter(group=>group.links.length).map(group=>[group.label,group.links]),[['资料与工具',[link]]]);
});
