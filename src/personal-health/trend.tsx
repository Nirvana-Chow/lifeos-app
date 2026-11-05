'use client';

import {useEffect,useRef,useState} from 'react';
import type {HealthTrend} from './projection';
import {healthMetricLabels} from './presentation';
import s from './health.module.css';

function UnitChart({unit,points,title}:{unit:string;points:HealthTrend['series'][number]['points'];title:string}) {
  const host = useRef<HTMLDivElement>(null);
  const [error,setError] = useState(false);
  useEffect(() => {
    let stopped = false;
    let cleanup = () => {};
    setError(false);
    void Promise.all([import('echarts/core'),import('echarts/charts'),import('echarts/components'),import('echarts/renderers')]).then(([e,charts,parts,renderers]) => {
      if (stopped || !host.current) return;
      e.use([charts.ScatterChart,parts.GridComponent,parts.TooltipComponent,parts.AriaComponent,renderers.SVGRenderer]);
      const chart = e.init(host.current,undefined,{renderer:'svg'});
      cleanup = () => chart.dispose();
      const paint = () => {
        if (!host.current) return;
        const style = getComputedStyle(host.current);
        const token = (name:string) => style.getPropertyValue(name).trim();
        chart.setOption({
          animation:false,
          aria:{enabled:true,label:{description:`${title}，${unit}，${points.length} 条有日期的记录。数据明细可在下方展开。`}},
          grid:{left:58,right:22,top:20,bottom:48},
          tooltip:{trigger:'item',backgroundColor:token('--card'),borderColor:token('--border'),textStyle:{color:token('--foreground')},renderMode:'richText'},
          xAxis:{type:'time',minInterval:86_400_000,splitNumber:3,axisLabel:{color:token('--muted-foreground'),formatter:'{yyyy}-{MM}-{dd}',hideOverlap:true},splitLine:{show:false}},
          yAxis:{type:'value',name:unit,scale:true,axisLabel:{color:token('--muted-foreground')},nameTextStyle:{color:token('--muted-foreground')},splitLine:{lineStyle:{color:token('--border')}}},
          series:[{type:'scatter',name:title+' ('+unit+')',symbolSize:9,itemStyle:{color:token('--primary')},data:points.map(point => [point.date+'T00:00:00Z',point.value]),encode:{x:0,y:1}}],
          useUTC:true,
        });
      };
      paint();
      const resize = new ResizeObserver(() => chart.resize());
      const theme = new MutationObserver(paint);
      const system = matchMedia('(prefers-color-scheme: dark)');
      resize.observe(host.current);
      theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-lifeos-theme','class','style']});
      system.addEventListener('change',paint);
      cleanup = () => {system.removeEventListener('change',paint);resize.disconnect();theme.disconnect();chart.dispose();};
    }).catch(() => {cleanup();if (!stopped) setError(true);});
    return () => {stopped = true;cleanup();};
  },[unit,points,title]);
  return <section>
    <h3>{title} · {unit}</h3>
    {error ? <p role="alert">趋势图未能加载，仍可展开数据明细。</p> : <div className={s.chart} ref={host} role="img" aria-label={`${title}，${unit}，${points.length} 条有日期的记录`}/>}
    <details><summary>数据明细（{points.length} 条）</summary><div className={s.trendTable}><table><caption>{title}（{unit}）</caption><thead><tr><th scope="col">日期</th><th scope="col">原始数值</th><th scope="col">修订</th></tr></thead><tbody>{points.map(point => <tr key={point.id}><td>{point.date}</td><td>{point.value} {unit}</td><td>{point.revision}</td></tr>)}</tbody></table></div></details>
  </section>;
}

export function HealthTrendView({trend}:{trend:HealthTrend}) {
  const title = healthMetricLabels[trend.metric];
  return <section aria-label="健康趋势" className={s.trend}>
    <p className={s.hint}>仅显示当前已读记录，按原单位分图。每点对应一条有日期的记录，不补零、不连接缺失值。{trend.undated} 条日期未知，{trend.missing} 条指标未知，{trend.plannedExcluded} 条训练计划已排除。</p>
    {trend.series.length ? trend.series.map(series => <UnitChart key={series.unit} {...series} title={title}/>) : <p>当前筛选没有可绘制的{title}记录。</p>}
  </section>;
}
