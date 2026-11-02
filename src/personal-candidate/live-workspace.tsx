'use client';
import type {WorkspacePage} from '../ui-review/contract';
import {LifeOSWorkspace} from '../ui-review/workspace';
import {ConnectedPersonalWorkspace} from './connected-workspace';
export function LivePersonalWorkspace({initialPage='overview',initialTaskId,initialCreateTask=false}:{initialPage?:WorkspacePage;initialTaskId?:string;initialCreateTask?:boolean}){
 return <ConnectedPersonalWorkspace initialTaskId={initialTaskId} initialCreateTask={initialCreateTask}>{props=><LifeOSWorkspace {...props} initialPage={initialPage} settingsContent={<><div className="lo-settings-links"><a href="/account/password">修改密码</a></div></>}/>}</ConnectedPersonalWorkspace>;
}
