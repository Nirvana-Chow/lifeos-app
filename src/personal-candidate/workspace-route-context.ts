'use client';
import {createContext,type RefObject} from 'react';
import type {LifeOSWorkspaceProps} from '../ui-review/contract';

export type WorkspaceRoutePath='/personal'|'/personal/journal';
export type WorkspaceRoute={path:WorkspaceRoutePath;push:(href:string)=>void};
export type TaskShellFrame=LifeOSWorkspaceProps&{showApiKeys?:boolean;passwordEnabled?:boolean};
export const WorkspaceRouteContext=createContext<{
 journalGuard:RefObject<(()=>boolean)|null>;
 publishTaskFrame:(frame:TaskShellFrame|null)=>void;
}|null>(null);
