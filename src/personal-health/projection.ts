import {PlatformError} from '../platform/domain.ts';
import type {HealthPersonalFields} from './domain.ts';

/** Root supplies only independently validated, owner-scoped records. */
export type HealthEntry = {id:string;revision:number;fields:HealthPersonalFields};
export const healthMetrics = ['weight','bodyFat','waist','sleepMinutes','trainingMinutes','distance'] as const;
export type HealthMetric = typeof healthMetrics[number];
export type HealthTrend = {
  metric:HealthMetric;
  series:{unit:string;points:{id:string;revision:number;date:string;value:number}[]}[];
  undated:number;
  missing:number;
  plannedExcluded:number;
};

/** One point per actual record; no averaging, interpolation or unit conversion. */
export function projectHealthTrend(records:readonly HealthEntry[],metric:HealthMetric):HealthTrend {
  if (!healthMetrics.includes(metric)) throw new PlatformError(400,'INVALID_HEALTH_METRIC','请选择支持的健康指标。');
  const result:HealthTrend = {metric,series:[],undated:0,missing:0,plannedExcluded:0};
  const series = new Map<string,HealthTrend['series'][number]>();
  for (const record of records) {
    const p = record.fields.personal;
    const kind = metric === 'weight' || metric === 'bodyFat' || metric === 'waist' ? 'body' : metric === 'sleepMinutes' ? 'sleep' : 'training';
    if (p.healthKind !== kind) continue;
    if (p.healthKind === 'training' && p.state === 'planned') {result.plannedExcluded++;continue;}
    if (record.fields.occurredOn === null) {result.undated++;continue;}
    const quantity = p.healthKind === 'body'
      ? metric === 'weight' ? p.weight : metric === 'waist' ? p.circumference.waist : p.bodyFatPercent === null ? null : {value:p.bodyFatPercent,unit:'%'}
      : p.healthKind === 'sleep'
        ? p.asleepMinutes === null ? null : {value:p.asleepMinutes,unit:'min'}
        : metric === 'distance' ? p.distance : p.durationMinutes === null ? null : {value:p.durationMinutes,unit:'min'};
    if (quantity === null) {result.missing++;continue;}
    let bucket = series.get(quantity.unit);
    if (!bucket) {bucket = {unit:quantity.unit,points:[]};series.set(quantity.unit,bucket);result.series.push(bucket);}
    bucket.points.push({id:record.id,revision:record.revision,date:record.fields.occurredOn,value:quantity.value});
  }
  for (const bucket of result.series) bucket.points.sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return result;
}

export const buildHealthTrend = projectHealthTrend;
