export type OwnerModuleLink={id:'calendar'|'journal'|'health'|'people'|'finance'|'roadmap'|'feedback'|'updates'|'media'|'career'|'portfolio';label:string;href:string};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function verifiedModuleScope(value:unknown):string|null{return object(value)&&value.scope==='personal-manual-candidate'&&value.storageVerified===true&&typeof value.ownerId==='string'&&value.ownerId.length>0&&typeof value.spaceId==='string'&&value.spaceId.length>0?JSON.stringify([value.ownerId,value.spaceId]):null;}
export function ownerModules(value:unknown,scope:string|null):OwnerModuleLink[]{
 const actual=verifiedModuleScope(value);if(!actual||scope!==null&&scope!==actual)return [];
 const v=value as Record<string,unknown>,links:OwnerModuleLink[]=[];
 if(Array.isArray(v.allowedTypes)&&v.allowedTypes.includes('journal'))links.push({id:'journal',label:'日记',href:'/personal/journal'});
 if(v.healthEnabled===true)links.push({id:'health',label:'健康',href:'/personal/health'});
 if(v.peopleEnabled===true)links.push({id:'people',label:'人物',href:'/personal/people'});
 if(v.financeEnabled===true)links.push({id:'finance',label:'财务',href:'/personal/finance'});
 if(v.mediaEnabled===true)links.push({id:'media',label:'书影音',href:'/personal/media'});
 if(v.careerEnabled===true)links.push({id:'career',label:'职业与简历',href:'/personal/career'});
 if(v.portfolioEnabled===true)links.push({id:'portfolio',label:'账户资产投资',href:'/personal/portfolio'});
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
