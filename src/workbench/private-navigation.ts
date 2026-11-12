import {workbenchNavigation,type ModuleId,type WorkbenchModule} from './navigation.ts';
import type {WorkspacePage, WorkspaceLocation, SettingsPanel} from '../ui-review/contract';

/** Finite canonical controller pages; query input never becomes a route or dispatcher. */
export function workspaceHref(page:WorkspacePage):string{return page==='settings'?workspaceLocationHref({page:'settings',panel:'general'}):page==='overview'?'/personal':'/personal?page='+page;}
export function readWorkspaceLocation(query: {page?: unknown; modal?: unknown; panel?: unknown; planId?: unknown}): WorkspaceLocation {
 const value=readWorkspacePage(query.page);
 const panel:SettingsPanel=query.panel==='topics'||query.panel==='security'||query.panel==='api-keys'?query.panel:'general';
 if(value==='settings'||query.modal==='settings')return {page:'settings',panel};
 const page=value;
 if(query.modal==='classification' && typeof query.planId==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(query.planId))return {page,modal:'classification',planId:query.planId};
 return {page};
}
export function workspaceLocationHref(location:WorkspaceLocation):string {
 const safe=readWorkspaceLocation(location),query=new URLSearchParams();
 if(safe.page!=='overview')query.set('page',safe.page);
 if(safe.page==='settings')query.set('panel',safe.panel??'general');
 if(safe.modal==='classification'){query.set('modal','classification');query.set('planId',safe.planId);}
 return '/personal'+(query.size?'?'+query.toString():'');
}
export function readWorkspacePage(value:unknown):WorkspacePage{
 return value==='tasks'||value==='inbox'||value==='areas'||value==='projects'||value==='settings'||value==='requirements'?value:'overview';
}
export const privateHrefs:Readonly<Record<ModuleId,string>>=Object.freeze({
 overview:workspaceHref('overview'),todos:workspaceHref('tasks'),inbox:workspaceHref('inbox'),settings:workspaceHref('settings'),
 journal:'/personal/edit?type=journal',search:'/personal/search',records:'/personal/records',finance:'/personal/finance',
 health:'/personal/health',growth:'/personal/growth',articles:'/personal/articles',albums:'/personal/albums',schedule:'/personal/schedule',
 time:'/personal/time',people:'/personal/people',files:'/personal/files',reports:'/personal/reports',outputs:'/personal/outputs',
 chat:'/personal/chat',knowledge:'/personal/knowledge',rag:'/personal/rag',agents:'/personal/agents',workflows:'/personal/workflows',
 executions:'/personal/executions',approvals:'/personal/approvals',tools:'/personal/tools','ai-settings':'/personal/settings/ai',database:'/personal/settings/data',
});
export const privateNavigation:readonly WorkbenchModule[]=Object.freeze(workbenchNavigation.map(module=>Object.freeze({...module,title:module.id==='todos'?'事项':module.title,href:privateHrefs[module.id]})));
/** Match complete decoded segments only. Never normalize, decode again or accept extra segments. */
export function resolvePrivateModule(section:readonly string[]):WorkbenchModule|null{
 if(!section.length||section.some(part=>!part||part.includes('/')||part.includes('%')||part.includes('?')))return null;
 const path='/personal/'+section.join('/');
 return privateNavigation.find(module=>!module.href.includes('?')&&module.href===path)??null;
}
export const primaryPrivateIds:readonly ModuleId[]=Object.freeze(['overview','todos','settings']);
