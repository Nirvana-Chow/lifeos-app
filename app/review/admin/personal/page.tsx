import {redirect} from 'next/navigation';
import {PersonalWorkspace} from '../../../../src/personal-candidate/workspace';
import type {PersonalType} from '../../../../src/personal-candidate/config';
import {validateId} from '../../../../src/platform/domain';
export default async function Page({searchParams}:{searchParams:Promise<{type?:string;id?:string}>}){const q=await searchParams;const type=['todo','journal','project','domain','topic'].includes(q.type??'')?q.type as PersonalType:'todo';if(type==='todo')redirect('/personal/edit?type=todo'+(q.id!==undefined?'&id='+encodeURIComponent(q.id):''));let id:string|undefined;try{if(q.id)id=validateId(q.id);}catch{}return <PersonalWorkspace initialType={type} initialId={id}/>;}
