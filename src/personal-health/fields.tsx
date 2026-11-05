'use client';

import {useState} from 'react';
import {circumferenceSites,healthKinds,type HealthPersonal,type Quantity} from './domain';
import {circumferenceLabels,emptyHealthFields,healthKindLabels} from './presentation';
import s from './health.module.css';

function QuantityInput<U extends string>({label,value,units,onChange}:{label:string;value:Quantity<U>|null;units:readonly U[];onChange:(value:Quantity<U>|null)=>void}) {
  const [unit,setUnit] = useState<U>(value?.unit ?? units[0]);
  const selected = value?.unit ?? (units.includes(unit) ? unit : units[0]);
  return <div className={s.quantity}>
    <label>{label}<input type="number" min="0" step="any" value={value?.value ?? ''} onChange={event => onChange(event.target.value === '' ? null : {value:Number(event.target.value),unit:selected})}/></label>
    <label>{label}单位<select value={selected} onChange={event => {const next = event.target.value as U;setUnit(next);if (value) onChange({...value,unit:next});}}>{units.map(unit => <option key={unit} value={unit}>{unit}</option>)}</select></label>
  </div>;
}

/** Title, body and occurredOn remain in the root's complete record editor. */
export function HealthFields({value,onChange,disabled=false,lockKind=false}:{value:HealthPersonal;onChange:(value:HealthPersonal)=>void;disabled?:boolean;lockKind?:boolean}) {
  const p = value;
  const change = (patch:object) => onChange({...p,...patch} as HealthPersonal);
  const number = (key:'bodyFatPercent'|'asleepMinutes'|'durationMinutes',label:string,value:number|null) => <label key={key}>{label}<input type="number" min="0" max={key === 'bodyFatPercent' ? 100 : undefined} step="any" value={value ?? ''} onChange={event => change({[key]:event.target.value === '' ? null : Number(event.target.value)})}/></label>;
  const instant = (key:'startedAt'|'endedAt'|'measuredAt',label:string,value:string|null) => <label key={key}>{label}<input type="text" placeholder="2026-11-05T08:00:00+08:00" value={value ?? ''} onChange={event => change({[key]:event.target.value || null})}/></label>;

  return <fieldset className={s.fields} disabled={disabled}>
    <legend>健康记录</legend>
    <div className={s.grid}>
      <label>记录类别<select aria-label="记录类别" disabled={lockKind} value={p.healthKind} onChange={event => {const next = emptyHealthFields(event.target.value as HealthPersonal['healthKind'],p.timeZone).personal;onChange({...next,source:p.source});}}>{healthKinds.map(kind => <option key={kind} value={kind}>{healthKindLabels[kind]}</option>)}</select></label>
      <label>记录时区<input required value={p.timeZone} onChange={event => change({timeZone:event.target.value})}/></label>
    </div>
    {p.healthKind === 'body' ? <>
      <div className={s.grid}>
        <QuantityInput label="体重" value={p.weight} units={['kg','lb']} onChange={weight => change({weight})}/>
        {number('bodyFatPercent','体脂率（%）',p.bodyFatPercent)}
      </div>
      {instant('measuredAt','测量时刻（含偏移，可留空）',p.measuredAt)}
      <details><summary>身体围度（可留空）</summary><div className={s.grid}>{circumferenceSites.map(site => <QuantityInput key={site} label={circumferenceLabels[site]} value={p.circumference[site]} units={['cm','in']} onChange={value => change({circumference:{...p.circumference,[site]:value}})}/>)}</div></details>
    </> : p.healthKind === 'sleep' ? <>
      <div className={s.grid}>
        {instant('startedAt','睡眠区间开始（含偏移，可留空）',p.startedAt)}
        {instant('endedAt','睡眠区间结束（含偏移，可留空）',p.endedAt)}
        {number('asleepMinutes','实睡分钟（可留空）',p.asleepMinutes)}
        <label>主观睡眠质量<select value={p.quality ?? ''} onChange={event => change({quality:event.target.value || null})}><option value="">未知</option><option value="poor">较差</option><option value="fair">一般</option><option value="good">较好</option></select></label>
      </div>
      <p className={s.hint}>实睡时长单独记录，不把整个区间自动算作睡眠。</p>
    </> : <>
      <div className={s.grid}>
        <label>活动类别<select value={p.activity} onChange={event => change({activity:event.target.value})}><option value="strength">力量</option><option value="cardio">有氧</option><option value="other">其他</option></select></label>
        <label>完成状态<select value={p.state} onChange={event => change({state:event.target.value})}><option value="planned">计划</option><option value="completed">已完成</option></select></label>
        {number('durationMinutes','训练分钟（可留空）',p.durationMinutes)}
        <QuantityInput label="距离" value={p.distance} units={['km','mi']} onChange={distance => change({distance})}/>
      </div>
      {instant('startedAt','训练开始（含偏移，可留空）',p.startedAt)}
      <p className={s.hint}>计划单独保留，不计入已完成训练趋势。</p>
    </>}
    <label>手工记录说明（可留空）<input maxLength={240} value={p.source.label ?? ''} onChange={event => change({source:{kind:'manual',label:event.target.value || null}})}/></label>
    <p className={s.hint}>留空表示未知；数值按输入单位保存。时刻需包含 Z 或 UTC 偏移。Apple 健康和训记来源尚未接入。</p>
  </fieldset>;
}
