'use client';
import {useEffect,useState} from 'react';
import {CalendarDays,NotebookPen,HeartPulse,Users,Wallet,Map as MapIcon,MessageSquare,History} from 'lucide-react';
import {ownerModules,verifiedModuleScope,type OwnerModuleLink} from './owner-modules';
import {supportJSON} from './requirement-support-hooks';
const icons={journal:NotebookPen,health:HeartPulse,people:Users,finance:Wallet,calendar:CalendarDays,roadmap:MapIcon,feedback:MessageSquare,updates:History};
/** Status composes existing owner capabilities; it grants no write authority. */
export function useOwnerModules(enabled:boolean,scope:string|null){
 const [value,setValue]=useState<unknown>(null),[path,setPath]=useState('');
 useEffect(()=>{let alive=true,generation=0;setValue(null);if(!enabled)return;
  const hide=()=>{generation++;setValue(null);};
  const check=async()=>{const token=++generation;setValue(null);try{const next=await supportJSON('status');if(alive&&token===generation){setValue(next);setPath(window.location.pathname);}}catch{/* Closed/unknown status exposes no links or private notice. */}};
  const visible=()=>{if(document.visibilityState==='hidden')hide();else void check();};
  void check();window.addEventListener('focus',check);window.addEventListener('pageshow',check);window.addEventListener('pagehide',hide);document.addEventListener('visibilitychange',visible);
  return()=>{alive=false;generation++;window.removeEventListener('focus',check);window.removeEventListener('pageshow',check);window.removeEventListener('pagehide',hide);document.removeEventListener('visibilitychange',visible);};
 },[enabled,scope]);
 return {links:enabled?ownerModules(value,scope):[],scope:enabled?verifiedModuleScope(value):null,path};
}
export function OwnerModuleLinks({links,path,collapsed}:{links:OwnerModuleLink[];path:string;collapsed:boolean}){return <>{links.map(link=>{const Icon=icons[link.id];return <a key={link.id} href={link.href} aria-label={link.label} title={collapsed?link.label:undefined} data-workspace-nav aria-current={path===link.href?'page':undefined}><Icon size={19}/><span>{link.label}</span></a>;})}</>;}
