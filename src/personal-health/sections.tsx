'use client';

import {useEffect, useState, type RefObject} from 'react';
import {elementScroll, measureElement, observeElementOffset, observeElementRect} from '@tanstack/react-virtual';
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

function exerciseBrowse(url:URL):ReturnType<typeof initialBrowse> {
  const view=url.searchParams.get('exerciseView');
  const category=url.searchParams.get('exerciseCategory');
  const status=url.searchParams.get('exerciseStatus');
  return {
    ...initialBrowse('exercise'),
    view:view==='table'||view==='trend'?view:'training',
    category:category==='training'||category==='frisbee'?category:'all',
    status:status==='planned'||status==='completed'?status:'all',
  };
}

function browseSection(current:ReturnType<typeof initialBrowse>,section:HealthSection,url:URL) {
  return section==='exercise'?exerciseBrowse(url):current.section===section?current:initialBrowse(section);
}

const exerciseDetailKey='lifeosExerciseDetail';

export function exerciseHistoryRecord(scope:string):string|null {
  const value=window.history.state?.[exerciseDetailKey];
  return window.location.hash==='#exercise'&&value?.scope===scope&&typeof value.id==='string'?value.id:null;
}

function pushHealthHistory(detail:{id:string;scope:string}|null,url?:string|URL) {
  const state={...window.history.state,[exerciseDetailKey]:detail};
  // Next copies its own state and synchronizes external URL changes through pushState.
  delete state.__NA;
  delete state._N;
  window.history.pushState(state,'',url);
}

export function pushExerciseHistoryRecord(id:string,scope:string,url?:string) {
  pushHealthHistory({id,scope},url===window.location.href?undefined:url);
}

function writeExerciseBrowse({view,category,status}:ReturnType<typeof initialBrowse>) {
  const url=new URL(window.location.href);
  url.hash='exercise';
  for(const [key,value,defaultValue] of [
    ['exerciseView',view,'training'],['exerciseCategory',category,'all'],['exerciseStatus',status,'all'],
  ]) {
    if(value===defaultValue)url.searchParams.delete(key);
    else url.searchParams.set(key,value);
  }
  if(url.href!==window.location.href)pushHealthHistory(null,url);
}

export function useHealthBrowse(enabled:boolean,root:RefObject<HTMLDivElement|null>) {
  const [browse,setBrowse] = useState(() => initialBrowse('body'));
  const [compact,setCompact] = useState(false);
  useEffect(() => {
    const host = root.current;
    if (!enabled || !host) return;
    const update = () => setCompact(host.clientWidth<620);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  },[enabled,root]);
  useEffect(() => {
    if (!enabled) return;
    function syncSection() {
      const url=new URL(window.location.href);
      const {hash}=url;
      const section = hash==='#exercise' ? 'exercise' : hash==='#sleep' ? 'sleep' : hash===''||hash==='#body' ? 'body' : null;
      if (!section) return;
      setBrowse(current => browseSection(current,section,url));
    }
    syncSection();
    window.addEventListener('hashchange',syncSection);
    window.addEventListener('popstate',syncSection);
    return () => {
      window.removeEventListener('hashchange',syncSection);
      window.removeEventListener('popstate',syncSection);
    };
  },[enabled]);
  useEffect(() => {
    if (!enabled) return;
    const main = root.current?.closest<HTMLElement>('main#personal-main');
    const skip = main?.closest('.lo-shell')?.querySelector<HTMLAnchorElement>(':scope > a.lo-skip[href="#personal-main"]');
    if (!main || !skip) return;

    let addedTabIndex = false;
    const focusMain = (event:MouseEvent) => {
      if (event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      // Keep the health section's deep link and browser history when jumping to the landmark.
      event.preventDefault();
      if (!main.hasAttribute('tabindex')) {
        main.tabIndex = -1;
        addedTabIndex = true;
      }
      main.focus({preventScroll:true});
      main.scrollIntoView({block:'start'});
    };
    skip.addEventListener('click',focusMain);
    return () => {
      skip.removeEventListener('click',focusMain);
      if (addedTabIndex && main.getAttribute('tabindex')==='-1') main.removeAttribute('tabindex');
    };
  },[enabled,root]);

  function setExerciseBrowse(change:Partial<Pick<typeof browse,'view'|'category'|'status'>>) {
    const next={...browse,...change};
    writeExerciseBrowse(next);
    setBrowse(next);
  }

  return {
    ...browse,
    ...sections[browse.section],
    compact,
    setSection:(section:HealthSection) => {
      const url=new URL(window.location.href);
      if(url.hash==='#'+section)return;
      url.hash=section;
      // A native fragment click can otherwise race the router's pending filter URL update.
      pushHealthHistory(null,url);
      setBrowse(current=>browseSection(current,section,url));
    },
    setView:(view:HealthView) => browse.section==='exercise' ? setExerciseBrowse({view}) : setBrowse(current => ({...current,view})),
    setMetric:(metric:HealthMetric) => setBrowse(current => ({...current,metric})),
    setCategory:(category:ExerciseCategory) => setExerciseBrowse({view:'table',category,status:browse.category===category?browse.status:'all'}),
    setStatus:(status:HealthRecordStatus) => setExerciseBrowse({view:'table',category:browse.view==='table'?browse.category:'all',status}),
  };
}

export function HealthSectionNav({section,onSection}:{section:HealthSection;onSection:(section:HealthSection)=>void}) {
  return <nav className={s.sectionNav} aria-label="健康分区">
    {(Object.keys(sections) as HealthSection[]).map(key => (
      <Button asChild key={key} size="sm" variant={section===key?'secondary':'ghost'}>
        <a href={'#'+key} aria-current={section===key?'location':undefined} onClick={event=>{
          if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return;
          event.preventDefault();
          onSection(key);
        }}>{sections[key].label}</a>
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

export const compactHealthVirtualizerOptions = {
  measureElement,
  observeElementRect,
  observeElementOffset,
  scrollToFn:elementScroll,
};

export function CompactHealthRow({title,summary,date,exerciseId,onOpen}:{
  title:string; summary:string; date:string|null; exerciseId?:string; onOpen:()=>void;
}) {
  return <div className={s.compactRow}>
    <Button type="button" variant="link" data-exercise-record={exerciseId} onClick={onOpen}>{title}</Button>
    <p>{summary}</p>
    {date && <time dateTime={date}>{date}</time>}
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
