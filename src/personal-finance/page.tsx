'use client';
import {useRef} from 'react';
import {LifeOSWorkspace} from '../ui-review/workspace';
import {PersonalFinanceWorkbench} from './workbench';
export function PersonalFinancePage(){const guard=useRef<(()=>boolean)|null>(null);return <LifeOSWorkspace state={{status:'unknown'}} access={{authenticated:true,writable:null,loginAllowed:true}} contentPage={{wide:true,title:'财务',content:<PersonalFinanceWorkbench navigationGuard={guard}/>}} onBeforeNavigate={()=>guard.current?.()!==false}/>;}
