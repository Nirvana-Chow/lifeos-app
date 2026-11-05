import {PlatformError,object} from '../platform/domain.ts';
import {validateCalendarDate,validateCalendarZone,validateCalendarSchedule} from '../calendar-candidate/domain.ts';
export const healthKinds=['body','sleep','training'] as const;
export const circumferenceSites=['waist','chest','hip','upperArm','thigh','calf'] as const;
export type Quantity<U extends string>={value:number;unit:U};
type Common={type:'health';schemaVersion:1;timeZone:string;source:{kind:'manual';label:string|null}};
export type HealthPersonal=Common&(
 {healthKind:'body';measuredAt:string|null;weight:Quantity<'kg'|'lb'>|null;bodyFatPercent:number|null;circumference:Record<typeof circumferenceSites[number],Quantity<'cm'|'in'>|null>}|
 {healthKind:'sleep';startedAt:string|null;endedAt:string|null;asleepMinutes:number|null;quality:'poor'|'fair'|'good'|null}|
 {healthKind:'training';activity:'strength'|'cardio'|'other';state:'planned'|'completed';startedAt:string|null;durationMinutes:number|null;distance:Quantity<'km'|'mi'>|null});
export type HealthPersonalFields={title:string;text:string;occurredOn:string|null;personal:HealthPersonal};
const invalid=(message='请核对健康记录的单位、时间与完整字段。'):never=>{throw new PlatformError(400,'INVALID_HEALTH_FIELDS',message);};
export function healthObject(value:unknown,keys:readonly string[]):Record<string,unknown>{const v=object(value,keys);if(keys.some(key=>!Object.hasOwn(v,key)))return invalid('必须提交完整字段；未知值请明确填写 null。');return v;}
function text(value:unknown,max:number,nullable=false):string|null{if(nullable&&value===null)return null;if(typeof value!=='string'||value.length>max||value.includes('\0'))return invalid();return value;}
function number(value:unknown,max=Number.MAX_SAFE_INTEGER,positive=false):number|null{if(value===null)return null;if(typeof value!=='number'||!Number.isFinite(value)||value<0||positive&&value===0||value>max)return invalid();return value;}
function quantity<U extends string>(value:unknown,units:readonly U[],positive=false):Quantity<U>|null{if(value===null)return null;const v=healthObject(value,['value','unit']);if(!units.includes(v.unit as U))return invalid();const n=number(v.value,Number.MAX_SAFE_INTEGER,positive);if(n===null)return invalid();return{value:n,unit:v.unit as U};}
export function validateHealthInstant(value:unknown,timeZone:string):string|null{
 if(value===null)return null;if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return invalid('时刻需要包含明确的 Z 或 UTC 偏移。');
 // Reuse native offset/DST validation, with an ephemeral one-ms validation range.
 // The supplied timestamp string is retained; no synthetic interval is stored.
 validateCalendarSchedule({kind:'timed',startAt:value,endAt:new Date(Date.parse(value)+1).toISOString(),timeZone});return value;
}
export function dateInHealthZone(at:string,zone:string):string{
 const fixed=/^([+-])(\d{2}):(\d{2})$/.exec(zone);if(fixed)return new Date(Date.parse(at)+(fixed[1]==='-'?-1:1)*(Number(fixed[2])*60+Number(fixed[3]))*60000).toISOString().slice(0,10);
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at));return ['year','month','day'].map(k=>parts.find(p=>p.type===k)!.value.padStart(k==='year'?4:2,'0')).join('-');
}
export function sleepElapsedMinutes(value:HealthPersonal):number|null{return value.healthKind==='sleep'&&value.startedAt!==null&&value.endedAt!==null?(Date.parse(value.endedAt)-Date.parse(value.startedAt))/60000:null;}
export function validateHealthPersonal(value:unknown):HealthPersonal{
 const raw=object(value,['type','schemaVersion','timeZone','source','healthKind','measuredAt','weight','bodyFatPercent','circumference','startedAt','endedAt','asleepMinutes','quality','activity','state','durationMinutes','distance']);
 const specific=raw.healthKind==='body'?['measuredAt','weight','bodyFatPercent','circumference']:raw.healthKind==='sleep'?['startedAt','endedAt','asleepMinutes','quality']:raw.healthKind==='training'?['activity','state','startedAt','durationMinutes','distance']:invalid();
 const v=healthObject(value,['type','schemaVersion','timeZone','source','healthKind',...specific]),source=healthObject(v.source,['kind','label']);
 if(v.type!=='health'||v.schemaVersion!==1||source.kind!=='manual')return invalid('此模块只接受个人手工记录；外部来源尚未接入。');
 const common:Common={type:'health',schemaVersion:1,timeZone:validateCalendarZone(v.timeZone),source:{kind:'manual',label:text(source.label,240,true)}};
 if(v.healthKind==='body'){
  const rawSites=healthObject(v.circumference,circumferenceSites),circumference={} as Extract<HealthPersonal,{healthKind:'body'}>['circumference'];for(const site of circumferenceSites)circumference[site]=quantity(rawSites[site],['cm','in'],true);
  return{...common,healthKind:'body',measuredAt:validateHealthInstant(v.measuredAt,common.timeZone),weight:quantity(v.weight,['kg','lb'],true),bodyFatPercent:number(v.bodyFatPercent,100),circumference};
 }
 if(v.healthKind==='sleep'){
  if(v.quality!==null&&!['poor','fair','good'].includes(String(v.quality)))return invalid();
  const result:HealthPersonal={...common,healthKind:'sleep',startedAt:validateHealthInstant(v.startedAt,common.timeZone),endedAt:validateHealthInstant(v.endedAt,common.timeZone),asleepMinutes:number(v.asleepMinutes),quality:v.quality as 'good'|null};
  const elapsed=sleepElapsedMinutes(result);if(elapsed!==null&&(elapsed<=0||result.asleepMinutes!==null&&result.asleepMinutes>elapsed))return invalid('睡眠结束必须晚于开始；实睡分钟不能超过间隔。');return result;
 }
 if(!['strength','cardio','other'].includes(String(v.activity))||!['planned','completed'].includes(String(v.state)))return invalid();
 return{...common,healthKind:'training',activity:v.activity as 'cardio',state:v.state as 'completed',startedAt:validateHealthInstant(v.startedAt,common.timeZone),durationMinutes:number(v.durationMinutes),distance:quantity(v.distance,['km','mi'])};
}
export function normalizeHealthPersonalFields(value:unknown):HealthPersonalFields{
 const v=healthObject(value,['title','text','occurredOn','personal']),title=text(v.title,240)!.trim();if(!title)return invalid('请填写标题。');
 const personal=validateHealthPersonal(v.personal),occurredOn=v.occurredOn===null?null:validateCalendarDate(v.occurredOn),at=personal.healthKind==='body'?personal.measuredAt:personal.startedAt;
 if(at!==null&&occurredOn!==null&&dateInHealthZone(at,personal.timeZone)!==occurredOn)return invalid('记录日期与时刻在所选时区中的日期不一致。');
 return{title,text:text(v.text,16384)!,occurredOn,personal};
}
