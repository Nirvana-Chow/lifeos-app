'use client';

// Adapted from imklayhu/xunji-log web/src/components/Chart.tsx (MIT).
// Copyright (c) 2026 xunji-log contributors. Full license/provenance: third-party/xunji-log/.
import {useEffect,useRef,useState} from 'react';
import s from './calendar.module.css';

export type ChartTheme = {foreground:string;muted:string;surface:string;border:string;primary:string;selected:string;unknown:string};
type Props = {option:(theme:ChartTheme)=>object;height?:number;className?:string;onEvents?:Record<string,(params:unknown)=>void>};

/** Keeps the upstream Chart prop seam, using the app's existing ECharts rather than another wrapper. */
export default function Chart({option,height=280,className,onEvents}:Props) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({option,onEvents});latest.current = {option,onEvents};
  const paintRef = useRef<() => void>(() => {});
  const [error,setError] = useState(false);
  useEffect(() => {
    let stopped = false;
    const cleanups:(() => void)[] = [];
    void Promise.all([import('echarts/core'),import('echarts/charts'),import('echarts/components'),import('echarts/renderers')]).then(([e,charts,parts,renderers]) => {
      if (stopped || !host.current) return;
      e.use([charts.HeatmapChart,parts.CalendarComponent,parts.VisualMapContinuousComponent,parts.TooltipComponent,parts.AriaComponent,renderers.SVGRenderer]);
      const chart = e.init(host.current,undefined,{renderer:'svg'});
      cleanups.push(() => chart.dispose());
      const paint = () => {
        if (!host.current) return;
        const style = getComputedStyle(host.current),token = (name:string) => style.getPropertyValue(name).trim();
        const theme:ChartTheme = {foreground:token('--foreground'),muted:token('--muted-foreground'),surface:token('--card'),border:token('--border'),primary:token('--primary'),selected:token('--lo-selected'),unknown:token('--input')};
        chart.setOption({backgroundColor:'transparent',textStyle:{color:theme.muted,fontSize:12},animation:false,...latest.current.option(theme)},{notMerge:true});
      };
      paintRef.current = paint;paint();
      chart.on('click',params => latest.current.onEvents?.click?.(params));
      const resize = new ResizeObserver(() => chart.resize());resize.observe(host.current);cleanups.push(() => resize.disconnect());
      const theme = new MutationObserver(paint);theme.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','data-lifeos-theme','data-lifeos-palette']});cleanups.push(() => theme.disconnect());
      const system = matchMedia('(prefers-color-scheme: dark)');system.addEventListener('change',paint);cleanups.push(() => system.removeEventListener('change',paint));
    }).catch(() => {for (const cleanup of cleanups.splice(0).reverse()) cleanup();if (!stopped) setError(true);});
    return () => {stopped = true;paintRef.current = () => {};for (const cleanup of cleanups.splice(0).reverse()) cleanup();};
  },[]);
  useEffect(() => {paintRef.current();},[option]);
  return error ? <p role="alert">运动日历图未能加载，仍可使用下方记录列表。</p> : <div ref={host} className={className ?? s.chart} style={{height}} role="img" aria-label="已读运动日历热力图"/>;
}
