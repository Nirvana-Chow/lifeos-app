import {appleOriginMarker} from './apple-origin.ts';
import type {PublicEntry} from '../platform/contracts.ts';
import type {PersonalRelations,PersonalObject,PersonalReference} from './business.ts';
export type BusinessRow={id:string;revision:number;kind:string;recordType:string;sourceLabel:string;title:string;domain:string;domainId:string|null;project:string;status:string;overdue:boolean;stage:string;nextStep:string;purpose:string;referenceChanged:boolean};
const names:Record<string,string>={todo:'待办',project:'项目',domain:'领域',topic:'主题',journal:'日记'};
export function projectRows(entries:PublicEntry[],spaceId:string,today:string):BusinessRow[]{
 const owned=entries.filter(e=>(e.source.original as {spaceId?:string;marker?:string}).spaceId===spaceId&&['personal-manual-v1',appleOriginMarker].includes((e.source.original as {marker:string}).marker)),byId=new Map(owned.map(e=>[e.id,e]));
 function resolve(ref:PersonalReference|null|undefined){const target=ref?byId.get(ref.id):null;return target&&target.source.id===ref!.sourceId?target:null;}
 return owned.map(e=>{const type=(e.source.original as {type:string}).type,d=e.draft,meta=('personal'in d?d.personal:undefined) as PersonalRelations|PersonalObject|undefined;
 const rel=meta&&(!('type'in meta)||meta.type==='project')?meta:null,p=rel&&'project'in rel?resolve(rel.project):null,pmeta=p&&'personal'in p.draft?p.draft.personal:null,domain=resolve(rel?.domain)??(pmeta&&'type'in pmeta&&pmeta.type==='project'?resolve(pmeta.domain):null),status=type==='todo'&&'status'in d?d.status:'',projectMeta=meta&&'type'in meta&&meta.type==='project'?meta:null;
 const refs=rel?[...('project'in rel&&rel.project?[rel.project]:[]),...(rel.domain?[rel.domain]:[]),...rel.topics]:[];
 return{id:e.id,revision:e.revision,kind:names[type]??type,recordType:type,sourceLabel:(e.source.original as {marker:string}).marker===appleOriginMarker?'Apple 提醒事项':'手工记录',title:'title'in d?d.title:'记录',domainId:domain?.id??null,domain:domain&&'title'in domain.draft?domain.draft.title:'未分类',project:p&&'title'in p.draft?p.draft.title:'—',status:({open:'未完成',in_progress:'进行中',done:'已完成',cancelled:'已取消'} as Record<string,string>)[status]??'—',overdue:type==='todo'&&(status==='open'||status==='in_progress')&&'dueOn'in d&&!!d.dueOn&&d.dueOn<today,stage:projectMeta?.stage??'',nextStep:projectMeta?.nextStep??'',purpose:projectMeta?.purpose??'',referenceChanged:refs.some(ref=>resolve(ref)?.revision!==ref.revision)||!!(!rel?.domain&&pmeta&&'type'in pmeta&&pmeta.type==='project'&&pmeta.domain&&resolve(pmeta.domain)?.revision!==pmeta.domain.revision)};
 });
}
export function taskStats(rows:BusinessRow[]){const tasks=rows.filter(r=>r.kind==='待办');return{open:tasks.filter(r=>r.status==='未完成'||r.status==='进行中').length,done:tasks.filter(r=>r.status==='已完成').length,cancelled:tasks.filter(r=>r.status==='已取消').length,overdue:tasks.filter(r=>r.overdue).length,total:tasks.length};}
