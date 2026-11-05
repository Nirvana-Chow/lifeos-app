import {circumferenceSites,sleepElapsedMinutes,type HealthPersonalFields,type HealthPersonal} from './domain.ts';

export const healthKindLabels = {body:'身体测量',sleep:'睡眠',training:'训练 / 有氧'};
export const healthMetricLabels = {weight:'体重',bodyFat:'体脂率',waist:'腰围',sleepMinutes:'实睡时长',trainingMinutes:'已完成训练时长',distance:'已完成训练距离'};
export const circumferenceLabels = {waist:'腰围',chest:'胸围',hip:'臀围',upperArm:'上臂围',thigh:'大腿围',calf:'小腿围'};

/** New fields carry no invented date, measurements or completion. */
export function emptyHealthFields(kind:HealthPersonal['healthKind'],timeZone:string):HealthPersonalFields {
  const common = {type:'health' as const,schemaVersion:1 as const,timeZone,source:{kind:'manual' as const,label:null}};
  return {
    title:'',text:'',occurredOn:null,
    personal:kind === 'body'
      ? {...common,healthKind:'body',measuredAt:null,weight:null,bodyFatPercent:null,circumference:Object.fromEntries(circumferenceSites.map(site => [site,null])) as Extract<HealthPersonal,{healthKind:'body'}>['circumference']}
      : kind === 'sleep'
        ? {...common,healthKind:'sleep',startedAt:null,endedAt:null,asleepMinutes:null,quality:null}
        : {...common,healthKind:'training',activity:'strength',state:'planned',startedAt:null,durationMinutes:null,distance:null},
  };
}

export function healthSummary(fields:HealthPersonalFields):string {
  const p = fields.personal;
  if (p.healthKind === 'body') return (p.weight ? `${p.weight.value} ${p.weight.unit}` : '体重未知') + ' · ' + (p.bodyFatPercent !== null ? `${p.bodyFatPercent}%` : '体脂未知');
  if (p.healthKind === 'sleep') {
    const elapsed = sleepElapsedMinutes(p);
    return (p.asleepMinutes !== null ? `实睡 ${p.asleepMinutes} min` : '实睡未知') + ' · ' + (elapsed === null ? '间隔未知' : `间隔 ${elapsed} min`);
  }
  return (p.state === 'planned' ? '计划' : '已完成') + ' · ' + ({strength:'力量',cardio:'有氧',other:'其他'}[p.activity]) + ' · ' + (p.durationMinutes === null ? '时长未知' : `${p.durationMinutes} min`) + ' · ' + (p.distance === null ? '距离未知' : `${p.distance.value} ${p.distance.unit}`);
}
