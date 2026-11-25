'use client';

import {useRef} from 'react';
import {LifeOSWorkspace} from '../ui-review/workspace';
import type {PersonalType} from './config';
import {PersonalWorkspace,personalWorkspaceLabels} from './workspace';

export function FocusedPersonalWorkspace({initialType,initialId}: {initialType:PersonalType;initialId?:string}) {
  const guard=useRef<(()=>boolean)|null>(null);
  return <LifeOSWorkspace desktopNavigation
    state={{status:'unknown'}}
    access={{authenticated:true,writable:null,loginAllowed:true}}
    onBeforeNavigate={()=>guard.current?.()!==false}
    contentPage={{title:personalWorkspaceLabels[initialType],content:
      <PersonalWorkspace initialType={initialType} initialId={initialId} returnHref="/personal" focused navigationGuard={guard}/>,
    }}
  />;
}
