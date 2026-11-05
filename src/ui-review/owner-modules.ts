export type OwnerModuleLink={id:'calendar'|'roadmap'|'feedback'|'updates';label:string;href:string};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function verifiedModuleScope(value:unknown):string|null{return object(value)&&value.scope==='personal-manual-candidate'&&value.storageVerified===true&&typeof value.ownerId==='string'&&value.ownerId.length>0&&typeof value.spaceId==='string'&&value.spaceId.length>0?JSON.stringify([value.ownerId,value.spaceId]):null;}
export function ownerModules(value:unknown,scope:string|null):OwnerModuleLink[]{
 const actual=verifiedModuleScope(value);if(!actual||scope!==null&&scope!==actual)return [];
 const v=value as Record<string,unknown>,links:OwnerModuleLink[]=[];
 if(v.calendarEnabled===true)links.push({id:'calendar',label:'日程',href:'/personal/schedule'});
 if(v.requirementsEnabled===true&&v.requirementSupportEnabled===true)links.push({id:'roadmap',label:'阶段路线图',href:'/personal/requirements/roadmap'},{id:'feedback',label:'反馈 Inbox',href:'/personal/requirements/feedback'},{id:'updates',label:'更新记录',href:'/personal/requirements/updates'});
 return links;
}
export type NoticeRecord={id:string;title:string;changes:string[]};
export type ReleaseNotice={sourceSha:string;records:NoticeRecord[]};
export function readReleaseNotice(value:unknown):ReleaseNotice|null{
 if(!object(value)||value.scope!=='public-source-records'||value.ownerAccepted!==false||value.visualQualification!=='not-attested'||value.preferencesEnabled!==true||!object(value.current)||!object(value.readState)||!Array.isArray(value.records)||value.records.length>100)return null;
 const current=value.current,read=value.readState;
 if(typeof current.sourceSha!=='string'||!/^[a-f0-9]{40}$/.test(current.sourceSha)||typeof current.sourceTreeDigest!=='string'||!/^[a-f0-9]{64}$/.test(current.sourceTreeDigest)||typeof current.buildId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(current.buildId)||read.sourceSha!==current.sourceSha||read.seen!==false)return null;
 const records:NoticeRecord[]=[];
 for(const row of value.records){
  if(!object(row)||typeof row.id!=='string'||typeof row.sourceSha!=='string'||!/^[a-f0-9]{40}$/.test(row.sourceSha)||row.sourceURL!=='https://github.com/Nirvana-Chow/lifeos-app/commit/'+row.sourceSha||typeof row.title!=='string'||!Array.isArray(row.changes)||row.changes.some(x=>typeof x!=='string'))return null;
  if(row.runningExactSource===true&&row.sourceSha===current.sourceSha)records.push({id:row.id,title:row.title,changes:row.changes as string[]});
 }
 return {sourceSha:current.sourceSha,records};
}
