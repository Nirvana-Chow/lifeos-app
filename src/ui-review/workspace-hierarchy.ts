import type {AreaRow,ProjectRow} from './contract.ts';
import type {OwnerModuleLink} from './owner-modules.ts';

/** Presentation only: groups existing status-authorized links, never creates capabilities. */
export function groupWorkspaceModules(links:readonly OwnerModuleLink[]){
 return [
  {label:'安排与推进',ids:['search','calendar']},
  {label:'生活记录',ids:['journal','health','cooking','people','media']},
  {label:'长期积累',ids:['career','finance','portfolio']},
 ].map(group=>({label:group.label,links:links.filter(link=>group.ids.includes(link.id))}));
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
