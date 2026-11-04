'use client';
import {ChevronRight, KeyRound, LockKeyhole} from 'lucide-react';
import type {WorkspacePage} from '../ui-review/contract';
import {LifeOSWorkspace} from '../ui-review/workspace';
import {ConnectedPersonalWorkspace} from './connected-workspace';
export function LivePersonalWorkspace({initialPage='overview',initialTaskId,initialCreateTask=false,showApiKeys=false}:{initialPage?:WorkspacePage;initialTaskId?:string;initialCreateTask?:boolean;showApiKeys?:boolean}){
 return <ConnectedPersonalWorkspace initialTaskId={initialTaskId} initialCreateTask={initialCreateTask}>{props=><LifeOSWorkspace {...props} syncUrl initialPage={initialPage} settingsContent={<div className="lo-settings-links"><a href="/account/password"><LockKeyhole size={18}/>修改密码<ChevronRight size={16} className="lo-settings-arrow"/></a>{showApiKeys&&<a href="/account/api-keys"><KeyRound size={18}/>API 密钥<ChevronRight size={16} className="lo-settings-arrow"/></a>}</div>}/>}</ConnectedPersonalWorkspace>;
}
