'use client';
import {LifeOSWorkspace} from '../ui-review/workspace';
import {ConnectedPersonalWorkspace} from './connected-workspace';
import {ThemeSwitch} from '../workbench/theme-switch';
export function LivePersonalWorkspace({initialPage='overview',initialTaskId,initialCreateTask=false}:{initialPage?:'overview'|'tasks';initialTaskId?:string;initialCreateTask?:boolean}){
 return <ConnectedPersonalWorkspace initialTaskId={initialTaskId} initialCreateTask={initialCreateTask}>{props=><LifeOSWorkspace {...props} initialPage={initialPage} settingsContent={<><div className="lo-settings-links"><a href="/account/password">修改密码</a></div><h2>外观</h2><ThemeSwitch/></>}/>}</ConnectedPersonalWorkspace>;
}
