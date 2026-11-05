import {ClassificationService} from '../../src/personal-candidate/classification-service.ts';
import {AuthorityService} from '../../src/agent-authority/service.ts';
import {ClassificationMemoryPort} from './classification-memory.ts';
import {PersonalService} from '../../src/personal-candidate/service.ts';
import type {PersonalConfig} from '../../src/personal-candidate/config.ts';
import type {AgentScope} from '../../src/agent-api/scopes.ts';
const config={ownerId:'fixture-owner',spaceId:'fixture-space',ownerEmail:'fixture@example.invalid',databaseName:'fixture',approval:'personal-manual-v1',baseURL:'https://fixture.example.invalid',allowedTypes:['todo','project','domain','topic','journal']} as PersonalConfig;
export async function fixture(write=false){
 const port=new ClassificationMemoryPort();let scopes:readonly AgentScope[]=write?['todo:read','todo:write','organization:read']:['todo:read','organization:read'];let active=true,writable=true,session=true,revision='a'.repeat(64),policy='policy-v1',now=Date.parse('2026-11-05T00:00:00.000Z');
 const grant=()=>active?{ownerId:config.ownerId,spaceId:config.spaceId,grantId:'fixture-grant',scopes,authorizationRevision:revision}:null;
 const authority=new AuthorityService({...config,verifyOwner:async()=>session?{ownerId:config.ownerId,spaceId:config.spaceId,sessionRef:'fixture-session'}:null,verifyAgent:async()=>grant(),readCurrentAgent:async()=>grant()});
 port.grantFence=async(binding,required)=>active&&binding.grantId==='fixture-grant'&&binding.ownerId===config.ownerId&&binding.spaceId===config.spaceId&&required.every(scope=>scopes.includes(scope));
 const service=new ClassificationService(port,config,{authority,assertReady:async()=>{},assertWritable:async()=>{if(!writable)throw Error('write-disabled');},policyRevision:()=>policy,now:()=>now});
 const personal=new PersonalService(port,config);
 const project=(await personal.mutate(config.ownerId,'project',null,{spaceId:config.spaceId,confirmed:true,fields:{title:'Project',text:'',occurredOn:null,personal:{type:'project',stage:'active',purpose:null,nextStep:'',domain:null,topics:[]}}},'seed-project')).entry;
 const todos=await Promise.all(['First','Last'].map(async(title,i)=>(await personal.mutate(config.ownerId,'todo',null,{spaceId:config.spaceId,confirmed:true,fields:{title,notes:'Keep',status:'open',dueOn:'2026-11-06'}},'seed-todo-'+i)).entry));
 const changes=todos.map(todo=>({todo:{id:todo.id,sourceId:todo.source.id,expectedRevision:todo.revision},before:null,after:{project:{id:project.id,sourceId:project.source.id,revision:project.revision},domain:null,topics:[]}}));
 const owner=(await authority.resolveOwnerActor(new Headers()))!,agent=(await authority.resolveAgentActor('fixture'))!;
 return{port,service,personal,authority,owner,agent,changes,todos,project,setActive:(v:boolean)=>{active=v;},setScopes:(v:readonly AgentScope[])=>{scopes=v;},setWritable:(v:boolean)=>{writable=v;},setSession:(v:boolean)=>{session=v;},setRevision:(v:string)=>{revision=v;},setPolicy:(v:string)=>{policy=v;},setNow:(v:number)=>{now=v;}};
}
