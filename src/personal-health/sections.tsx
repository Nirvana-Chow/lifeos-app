'use client';

import {useEffect, useState, type MouseEvent as ReactMouseEvent, type RefObject} from 'react';
import {elementScroll, measureElement, observeElementOffset, observeElementRect} from '@tanstack/react-virtual';
import {Button} from '../ui-review/ui/button';
import type {HealthPersonal} from './domain';
import {bodySections,healthMetricLabels,type BodySection} from './presentation';
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

function initialBrowse(section:HealthSection,bodySection:BodySection|null=null,bodyOriginals=false) {
  return {
    section,bodySection,bodyOriginals,
    view:(section==='exercise'?'training':'table') as HealthView,
    metric:(bodySection?bodySections[bodySection].trend:sections[section].metrics[0]) as HealthMetric,
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
  if(section==='exercise')return exerciseBrowse(url);
  const bodySection=section==='body'?readBodyLocation(url.hash)?.section??null:null;
  const bodyOriginals=section==='body'&&url.hash==='#body-originals';
  return current.section===section&&current.bodySection===bodySection&&current.bodyOriginals===bodyOriginals
    ?current:initialBrowse(section,bodySection,bodyOriginals);
}

const healthDetailKey='lifeosExerciseDetail';
type HealthDetail = {id:string;scope:string};

function readBodyLocation(hash:string) {
  const match=/^#body-(weight|fat|circumference)(?:\/([a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}))?$/i.exec(hash);
  if(!match || !Object.hasOwn(bodySections,match[1]))return null;
  return {section:match[1] as BodySection,id:match[2]?.toLowerCase()??null};
}

export function bodySectionHref(section:BodySection,id?:string) {
  return '#body-'+section+(id?'/'+encodeURIComponent(id):'');
}

export function healthHistoryRecord(scope:string) {
  const value=window.history.state?.[healthDetailKey] as HealthDetail|undefined;
  const hash=window.location.hash;
  if(value&&value.scope!==scope)return null;
  if(hash==='#exercise'&&value&&typeof value.id==='string')return {id:value.id,bodySection:null};
  const body=readBodyLocation(hash);
  return body?.id?{id:body.id,bodySection:body.section}:null;
}

function writeHealthHistory(detail:HealthDetail|null,url?:string|URL,replace=false) {
  const state={...window.history.state,[healthDetailKey]:detail};
  // Next copies its own state and synchronizes external URL changes through pushState.
  delete state.__NA;
  delete state._N;
  if(replace)window.history.replaceState(state,'',url);
  else window.history.pushState(state,'',url);
}

export function pushHealthHistoryRecord(id:string,scope:string,url:string) {
  writeHealthHistory({id,scope},url===window.location.href?undefined:url);
}

export function closeHealthHistoryRecord(id:string,scope:string,bodySection:BodySection|null) {
  const value=window.history.state?.[healthDetailKey] as HealthDetail|undefined;
  if(value?.id===id&&value.scope===scope){
    window.history.back();
    return true;
  }
  if(bodySection){
    const url=new URL(window.location.href);
    url.hash=bodySectionHref(bodySection);
    writeHealthHistory(null,url,true);
  }
  return false;
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
  if(url.href!==window.location.href)writeHealthHistory(null,url);
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
      const section = hash==='#exercise' ? 'exercise' : hash==='#sleep' ? 'sleep' : hash===''||hash==='#body'||hash==='#body-originals'||readBodyLocation(hash) ? 'body' : null;
      if (!section) return;
      setBrowse(current => browseSection(current,section,url));
    }
    syncSection();
    window.addEventListener('hashchange',syncSection);
    function traverse() {
      const selected=root.current?.querySelector<HTMLAnchorElement>('[aria-label="身体指标记录"] a[aria-current]');
      syncSection();
      const location=readBodyLocation(window.location.hash);
      if(location?.id || document.querySelector('[role="dialog"]') || (!location && window.location.hash!=='' && window.location.hash!=='#body'))return;
      requestAnimationFrame(()=>{
        if(document.querySelector('[role="dialog"]'))return;
        const next=root.current?.querySelector<HTMLAnchorElement>('[aria-label="身体指标记录"] a[aria-current]');
        (next??selected)?.focus({preventScroll:true});
      });
    }
    window.addEventListener('popstate',traverse);
    return () => {
      window.removeEventListener('hashchange',syncSection);
      window.removeEventListener('popstate',traverse);
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

  function setLocation(section:HealthSection,hash:string) {
    const url=new URL(window.location.href);
    if(url.hash===hash)return;
    url.hash=hash;
    // Keep the router and local view on the same fragment.
    writeHealthHistory(null,url);
    setBrowse(current=>browseSection(current,section,url));
  }

  return {
    ...browse,
    ...sections[browse.section],
    compact,
    metrics:browse.bodySection?[bodySections[browse.bodySection].trend]:sections[browse.section].metrics,
    setSection:(section:HealthSection) => setLocation(section,'#'+section),
    setBodySection:(section:BodySection) => setLocation('body',bodySectionHref(section)),
    showBodyOriginals:() => setLocation('body','#body-originals'),
    setView:(view:HealthView) => browse.section==='exercise' ? setExerciseBrowse({view}) : setBrowse(current => ({...current,view})),
    setMetric:(metric:HealthMetric) => setBrowse(current => ({...current,metric})),
    setCategory:(category:ExerciseCategory) => setExerciseBrowse({view:'table',category,status:browse.category===category?browse.status:'all'}),
    setStatus:(status:HealthRecordStatus) => setExerciseBrowse({view:'table',category:browse.view==='table'?browse.category:'all',status}),
  };
}

export function followHealthLink(event:ReactMouseEvent<HTMLAnchorElement>,navigate:()=>void) {
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return;
  event.preventDefault();
  // Anchors remain native links for copying or opening in a new tab.
  event.currentTarget.focus({preventScroll:true});
  navigate();
}

export function BodySectionNav({section,onSection}:{section:BodySection|null;onSection:(section:BodySection)=>void}) {
  return <nav className={s.bodyNav} aria-label="身体指标记录">
    {(Object.keys(bodySections) as BodySection[]).map(key => (
      <Button asChild key={key} variant={section===key?'secondary':'outline'}>
        <a href={bodySectionHref(key)} aria-current={section===key?'location':undefined}
          onClick={event=>followHealthLink(event,()=>onSection(key))}>{bodySections[key].label}</a>
      </Button>
    ))}
  </nav>;
}

export function BodyOriginalsLink({onOpen}:{onOpen:()=>void}) {
  return <a className={s.originalsLink} href="#body-originals" onClick={event=>followHealthLink(event,onOpen)}>查看全部原始身体测量</a>;
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

export function CompactHealthRow({title,summary,date,detailId,href,onOpen}:{
  title:string; summary:string; date:string|null; detailId?:string; href?:string; onOpen:()=>void;
}) {
  return <div className={s.compactRow}>
    {href
      ? <Button asChild variant="link"><a href={href} data-health-record={detailId} onClick={event=>followHealthLink(event,onOpen)}>{title}</a></Button>
      : <Button type="button" variant="link" data-health-record={detailId} onClick={onOpen}>{title}</Button>}
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
