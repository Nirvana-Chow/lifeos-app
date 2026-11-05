import {validateCalendarDate} from '../../calendar-candidate/domain.ts';
import type {HealthPersonalFields,Quantity} from '../domain.ts';

export type TrainingCalendarRecord = {id:string;revision:number;fields:HealthPersonalFields};
export type TrainingRow = {id:string;revision:number;title:string;date:string|null;activity:'strength'|'cardio'|'other';durationMinutes:number|null;distance:Quantity<'km'|'mi'>|null};
export type TrainingDay = {date:string;sessions:number;duration_min:number|null;distances:Partial<Record<'km'|'mi',number|null>>;records:TrainingRow[]};
export type TrainingCalendarData = {date_start:string|null;date_end:string|null;n_days:number;n_sessions:number;daily:TrainingDay[];completed:TrainingRow[];planned:TrainingRow[];undated:TrainingRow[];years:string[]};
export type TrainingMetric = 'sessions'|'duration_min'|'distance_km'|'distance_mi';
export const trainingMetricLabels:Record<TrainingMetric,string> = {sessions:'运动次数',duration_min:'运动时长（分钟）',distance_km:'距离（km）',distance_mi:'距离（mi）'};

/** Narrow adapter into the upstream Calendar's daily analysis contract. No source API is called. */
export function adaptTrainingRecords(records:readonly TrainingCalendarRecord[]):TrainingCalendarData {
  const completed:TrainingRow[] = [],planned:TrainingRow[] = [],groups = new Map<string,TrainingRow[]>();
  for (const {id,revision,fields} of records) {
    const p = fields.personal;if (p.healthKind !== 'training') continue;
    const date = fields.occurredOn === null ? null : validateCalendarDate(fields.occurredOn);
    const row:TrainingRow = {id,revision,title:fields.title,date,activity:p.activity,durationMinutes:p.durationMinutes,distance:p.distance};
    if (p.state === 'planned') {planned.push(row);continue;}
    completed.push(row);
    if (date !== null) {const group = groups.get(date) ?? [];group.push(row);groups.set(date,group);}
  }
  const daily = [...groups].sort(([a],[b]) => a.localeCompare(b)).map(([date,rows]):TrainingDay => {
    const distances:TrainingDay['distances'] = {};
    for (const row of rows) if (row.distance !== null) distances[row.distance.unit] = (distances[row.distance.unit] ?? 0)+row.distance.value;
    // A partial sum must not look like a known complete day total.
    if (rows.some(row => row.distance === null)) for (const unit of ['km','mi'] as const) if (Object.hasOwn(distances,unit)) distances[unit] = null;
    return {date,sessions:rows.length,duration_min:rows.some(row => row.durationMinutes === null) ? null : rows.reduce((sum,row) => sum+row.durationMinutes!,0),distances,records:[...rows].sort((a,b) => a.id.localeCompare(b.id))};
  });
  return {date_start:daily[0]?.date ?? null,date_end:daily.at(-1)?.date ?? null,n_days:daily.length,n_sessions:completed.length,daily,completed,planned,undated:completed.filter(row => row.date === null),years:[...new Set(daily.map(day => day.date.slice(0,4)))].sort().reverse()};
}

export function trainingMetricValue(day:TrainingDay,metric:TrainingMetric):number|null {
  return metric === 'sessions' ? day.sessions : metric === 'duration_min' ? day.duration_min : day.distances[metric === 'distance_km' ? 'km' : 'mi'] ?? null;
}

/** Retains the original Calendar's cell shape, but absent days are never manufactured. */
export function trainingCalendarCells(days:readonly TrainingDay[],metric:TrainingMetric) {
  return days.map(day => ({date:day.date,value:trainingMetricValue(day,metric),label:day.date.slice(5),sessions:day.sessions}));
}

export function trainingCalendarRange(data:TrainingCalendarData,range:string):{start:string;end:string}|null {
  if (!data.date_end) return null;
  if (range !== 'recent') return {start:validateCalendarDate(range+'-01-01'),end:validateCalendarDate(range+'-12-31')};
  const end = new Date(data.date_end+'T00:00:00Z');end.setUTCDate(end.getUTCDate()-89);
  return {start:end.toISOString().slice(0,10),end:data.date_end};
}

export function trainingDayRecordIds(data:TrainingCalendarData,date:string):string[] {
  return data.daily.find(day => day.date === date)?.records.map(row => row.id) ?? [];
}

export function trainingCalendarClickDate(params:unknown):string|null {
  if (!params || typeof params !== 'object' || !('data' in params)) return null;
  const raw = params.data;
  const value = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && 'value' in raw ? raw.value : null;
  if (!Array.isArray(value)) return null;
  try {return validateCalendarDate(value[0]);} catch {return null;}
}
