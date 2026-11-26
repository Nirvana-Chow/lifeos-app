'use client';

import {useEffect, useState} from 'react';
import {Button} from '../ui-review/ui/button';
import type {HealthPersonal} from './domain';
import {healthMetricLabels} from './presentation';
import type {HealthMetric} from './projection';
import type {ExerciseCategory, HealthRecordStatus} from './record-filter';
import s from './health.module.css';

type HealthSection = 'body' | 'exercise' | 'sleep';
type HealthView = 'table' | 'trend' | 'training';

const sections = {
  body: {label:'身体指标', kind:'body', metrics:['weight','bodyFat','waist']},
  exercise: {label:'运动', kind:'training', metrics:['trainingMinutes','distance']},
  sleep: {label:'睡眠', kind:'sleep', metrics:['sleepMinutes']},
} as const satisfies Record<HealthSection, {
  label:string; kind:HealthPersonal['healthKind']; metrics:readonly [HealthMetric, ...HealthMetric[]];
}>;

function initialBrowse(section:HealthSection) {
  return {
    section,
    view:(section==='exercise'?'training':'table') as HealthView,
    metric:sections[section].metrics[0] as HealthMetric,
    category:'all' as ExerciseCategory,
    status:'all' as HealthRecordStatus,
  };
}

export function useHealthBrowse(enabled:boolean) {
  const [browse,setBrowse] = useState(() => initialBrowse('body'));
  useEffect(() => {
    if (!enabled) return;
    function syncSection() {
      const hash = window.location.hash;
      const section = hash==='#exercise' ? 'exercise' : hash==='#sleep' ? 'sleep' : 'body';
      setBrowse(current => current.section===section ? current : initialBrowse(section));
    }
    syncSection();
    window.addEventListener('hashchange',syncSection);
    return () => window.removeEventListener('hashchange',syncSection);
  },[enabled]);

  return {
    ...browse,
    ...sections[browse.section],
    setView:(view:HealthView) => setBrowse(current => ({...current,view})),
    setMetric:(metric:HealthMetric) => setBrowse(current => ({...current,metric})),
    setCategory:(category:ExerciseCategory) => setBrowse(current => current.category===category ? current : ({...current,category,status:'all'})),
    setStatus:(status:HealthRecordStatus) => setBrowse(current => ({...current,status})),
  };
}

export function HealthSectionNav({section}:{section:HealthSection}) {
  return <nav className={s.sectionNav} aria-label="健康分区">
    {(Object.keys(sections) as HealthSection[]).map(key => (
      <Button asChild key={key} size="sm" variant={section===key?'secondary':'ghost'}>
        <a href={'#'+key} aria-current={section===key?'location':undefined}>{sections[key].label}</a>
      </Button>
    ))}
  </nav>;
}

export function HealthViewControls({section,view,onView}:{
  section:HealthSection; view:HealthView; onView:(view:HealthView)=>void;
}) {
  const labels = {training:'日历',table:'表格',trend:'趋势'} as const;
  const views = section==='exercise' ? (['training','table','trend'] as const) : (['table','trend'] as const);
  return <div className={s.viewControls} role="group" aria-label={sections[section].label+'视图'}>
    {views.map(key => (
      <Button key={key} type="button" size="sm" variant={view===key?'secondary':'ghost'}
        aria-pressed={view===key} onClick={()=>onView(key)}>{labels[key]}</Button>
    ))}
  </div>;
}

export function HealthMetricOptions({metrics}:{metrics:readonly HealthMetric[]}) {
  return metrics.map(metric => <option key={metric} value={metric}>{healthMetricLabels[metric]}</option>);
}

export function HealthSourceNote({showNutrition}:{showNutrition:boolean}) {
  return <p className={s.hint}>
    来源为站内手工记录，历史覆盖未知。Apple 健康与训记自动来源未接入。
    {showNutrition && <> <span>饮食 · 未接入</span></>}
  </p>;
}
