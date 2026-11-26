'use client';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {useContext,useState,useSyncExternalStore,type ReactNode} from 'react';
import {readWorkspaceLocation} from '../workbench/private-navigation';
import {PersonalWorkspaceView} from './live-workspace';
import {PrivacyBoundary,useOwnerPageVerification} from './privacy';
import {isWorkspaceRoute,WorkspaceRouteContext,type TaskShellFrame,type WorkspaceRoutePath} from './workspace-route-context';

function createTaskFrame(){
 let current:TaskShellFrame|null=null;
 const listeners=new Set<()=>void>();
 return {
  read:()=>current,
  subscribe(listener:()=>void){listeners.add(listener);return()=>listeners.delete(listener);},
  publish(frame:TaskShellFrame|null){
   current=frame;
   for(const listener of listeners)listener();
  },
 };
}
type Frame=ReturnType<typeof createTaskFrame>;
const emptyFrame=()=>null;

type Options={children:ReactNode};

export function PersistentPersonalWorkspace(props:Options){
 const path=usePathname();
 if(!isWorkspaceRoute(path))return props.children;
 return <PrivacyBoundary><WorkspaceRoutes path={path} {...props}/></PrivacyBoundary>;
}

function WorkspaceRoutes({path,children}:Options&{path:WorkspaceRoutePath}){
 const router=useRouter(),query=useSearchParams();
 const location=readWorkspaceLocation(path==='/personal'?Object.fromEntries(query):{});
 const [store]=useState(createTaskFrame);
 const [route]=useState(()=>({activeContentGuard:{current:null as (()=>boolean)|null},publishTaskFrame:store.publish}));
 return <WorkspaceRouteContext.Provider value={route}>
  <PersistentFrame path={path} store={store} location={location}
   push={href=>router.push(href,{scroll:false})}>
   {path!=='/personal'?children:null}
  </PersistentFrame>
  {path==='/personal'&&children}
 </WorkspaceRouteContext.Provider>;
}

function PersistentFrame({path,store,location,push,children}:Options&{
 path:WorkspaceRoutePath;store:Frame;location:ReturnType<typeof readWorkspaceLocation>;push:(href:string)=>void;
}){
 const task=useSyncExternalStore(store.subscribe,store.read,emptyFrame);
 const route=useContext(WorkspaceRouteContext);
 const verified=useOwnerPageVerification();
 const isContentRoute=path!=='/personal';
 return <PersonalWorkspaceView {...(isContentRoute||!task?{
  state:{status:'unknown'},access:{authenticated:isContentRoute&&verified===true?true:null,writable:null,loginAllowed:true},
 }:task)}
  initialPage={location.page} initialModal={location.page==='settings'?'settings':location.modal}
  initialSettingsPanel={location.panel} initialClassificationPlanId={location.planId}
  unifiedRoute={{path,push}}
  {...(isContentRoute?{
   contentPage:{wide:true,title:path==='/personal/finance'?'财务':'记录',content:children},
   onBeforeNavigate:()=>route?.activeContentGuard.current?.()!==false,
  }:{})}
 />;
}
