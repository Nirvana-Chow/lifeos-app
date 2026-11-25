import type {AreaRow,ProjectRow} from './contract.ts';
import type {OwnerModuleLink} from './owner-modules.ts';

const workspaceModules = [
 {id:'daily',label:'日常',pages:['overview','tasks','projects','areas'],links:['calendar','journal','search']},
 {id:'health',label:'身体基础',pages:[],links:['health']},
 {id:'learning',label:'兴趣学习',pages:[],links:['media','cooking']},
 {id:'relationships',label:'生活与关系',pages:[],links:['people']},
 {id:'finance',label:'财务',pages:[],links:['finance','portfolio']},
 {id:'career',label:'职业成长',pages:[],links:['career']},
 {id:'projects',label:'软件开发',pages:[],links:['development-projects']},
] as const;

/** Present existing destinations in module order. Settings retains its own tools. */
export function groupWorkspaceModules(links:readonly OwnerModuleLink[]){
 return workspaceModules.map(group=>({
  id:group.id,label:group.label,pages:group.pages,
  links:group.links.flatMap(id=>{
   const link=links.find(candidate=>candidate.id===id);
   return link?[id==='journal'?{...link,label:'记录'}:link]:[];
  }),
 })).filter(group=>group.pages.length||group.links.length);
}

export type OverviewDomain={id:string|null;title:string;loaded:boolean;projects:ProjectRow[]};
/** Keep active-project semantics and source ordering; unavailable references remain explicit. */
export function overviewDomains(areas:readonly AreaRow[],projects:readonly ProjectRow[]):OverviewDomain[]{
 const groups:OverviewDomain[]=areas.map(area=>({id:area.id,title:area.title,loaded:true,projects:[]}));
 const byId=new Map(groups.map(group=>[group.id,group]));
 let unassigned:OverviewDomain|undefined;
 for(const project of projects){
  if(project.stage!=='active')continue;
  if(!project.area){
   unassigned??={id:null,title:'未关联领域',loaded:true,projects:[]};
   unassigned.projects.push(project);continue;
  }
  let group=byId.get(project.area.id);
  if(!group){group={id:project.area.id,title:project.area.title,loaded:false,projects:[]};groups.push(group);byId.set(group.id,group);}
  group.projects.push(project);
 }
 if(unassigned)groups.push(unassigned);
 return groups;
}
