import {workbenchNavigation,type ModuleId,type WorkbenchModule} from './navigation.ts';
import type {WorkspacePage} from '../ui-review/contract';

/** Finite canonical controller pages; query input never becomes a route or dispatcher. */
export function workspaceHref(page:WorkspacePage):string{return page==='overview'?'/personal':'/personal?page='+page;}
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
export const privateNavigation:readonly WorkbenchModule[]=Object.freeze(workbenchNavigation.map(module=>Object.freeze({...module,href:privateHrefs[module.id]})));
/** Match complete decoded segments only. Never normalize, decode again or accept extra segments. */
export function resolvePrivateModule(section:readonly string[]):WorkbenchModule|null{
 if(!section.length||section.some(part=>!part||part.includes('/')||part.includes('%')||part.includes('?')))return null;
 const path='/personal/'+section.join('/');
 return privateNavigation.find(module=>!module.href.includes('?')&&module.href===path)??null;
}
export const primaryPrivateIds:readonly ModuleId[]=Object.freeze(['overview','todos','settings']);
