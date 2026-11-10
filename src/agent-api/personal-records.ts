import type {PlatformRepository,PublicEntry,Transaction} from '../platform/contracts.ts';
import {object,PlatformError} from '../platform/domain.ts';
import {PersonalService,personalEntryType} from '../personal-candidate/service.ts';
import type {PersonalConfig} from '../personal-candidate/config.ts';
import type {AgentModules} from './config.ts';
import {personalRecordTypes,type AgentRecordType} from './personal-operation-registry.ts';

export function isRecordModule(module:string):module is AgentRecordType|'feedback'{return (personalRecordTypes as readonly string[]).includes(module)||module==='feedback';}
export function personalRecordModuleEnabled(module:string,config:PersonalConfig,modules:AgentModules):boolean{
 if(!modules.personalRecords||!modules.businessDataPolicy)return false;
 switch(module){
  case 'journal':return config.allowedTypes.includes('journal');
  case 'calendar':return config.calendarEnabled===true;
  case 'health':return config.healthEnabled===true;
  case 'person':return config.peopleEnabled===true;
  case 'finance':return config.financeEnabled===true;
  case 'media':return config.mediaEnabled===true;
  case 'career':return config.careerEnabled===true;
  case 'portfolio':return config.portfolioEnabled===true;
  case 'cooking':return config.cookingEnabled===true;
  case 'feedback':return config.requirementSupportEnabled===true&&config.requirementsEnabled===true;
  default:return false;
 }
}
export function completeRecordFields(input:unknown,type:AgentRecordType){
 const keys=['title','text','occurredOn','personal'],fields=object(input,keys);
 if(keys.some(key=>!Object.hasOwn(fields,key)))throw new PlatformError(400,'COMPLETE_RECORD_REQUIRED','保存需要完整记录字段。');
 // Journal's legacy writer omits metadata rather than persisting a null object.
 if(type==='journal'&&fields.personal===null){const {personal,...rest}=fields;void personal;return rest;}
 return fields;
}
export function personalRecordDetail(entry:PublicEntry,spaceId:string){
 const type=personalEntryType(entry,spaceId);
 if(!type||!(personalRecordTypes as readonly string[]).includes(type)||!('text' in entry.draft))throw new PlatformError(404,'NOT_FOUND','没有可访问的记录。');
 const {title,text,occurredOn,personal}=entry.draft;
 return{type,id:entry.id,sourceId:entry.source.id,revision:entry.revision,fields:{title,text,occurredOn,personal:personal??null}};
}
export async function personalRecordSnapshot(service:PersonalService,owner:string,type:Exclude<AgentRecordType,'finance'>){
 const items=(await service.currentSnapshot(owner)).filter(entry=>personalEntryType(entry,service.config.spaceId)===type).map(entry=>personalRecordDetail(entry,service.config.spaceId));
 return{scope:`full-current-${type}-snapshot`,items,total:items.length,truncated:false,observedAt:new Date().toISOString()};
}
/** Reuse the same native writer. Every receipt and persistence phase rechecks its transaction-held grant. */
export function fencedRecordRepository(repository:PlatformRepository,guard:(tx:Transaction)=>Promise<void>):PlatformRepository{
 return new Proxy(repository,{get(target,key){
  if(key==='transaction')return <T>(owner:string,command:string,run:(tx:Transaction)=>Promise<T>)=>target.transaction(owner,command,tx=>run({...tx,
   receipt:async()=>{await guard(tx);const value=await tx.receipt();await guard(tx);return value;},
   write:async(...args)=>{await guard(tx);await tx.write(...args);await guard(tx);},
   saveReceipt:async value=>{await guard(tx);await tx.saveReceipt(value);await guard(tx);},
  }));
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
}
