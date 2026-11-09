'use client';

// Adapted directly from imklayhu/xunji-log web/src/pages/Calendar.tsx (MIT),
// commit 267c02e96f7b18fcaf14d742f54253f55cb42dd8.
// Copyright (c) 2026 xunji-log contributors. Full original source/license: third-party/xunji-log/.
import {useCallback,useEffect,useMemo,useState} from 'react';
import {Button} from '../../ui-review/ui/button';
import Chart,{type ChartTheme} from './chart';
import {adaptTrainingRecords,trainingCalendarCells,trainingCalendarClickDate,trainingCalendarRange,trainingDayRecordIds,trainingMetricLabels,trainingMetricValue,type TrainingCalendarRecord,type TrainingMetric,type TrainingRow} from './adapter';
import {TrainingAnalyticsPanel} from '../training-analytics/panel';
import s from './calendar.module.css';

export type TrainingCalendarProps = {records:readonly TrainingCalendarRecord[];onOpenRecord:(id:string)=>void};
const activityLabels = {strength:'力量训练',cardio:'有氧运动',other:'其他运动'};
const recordMetrics = (row:TrainingRow) => `${activityLabels[row.activity]} · ${row.durationMinutes === null ? '时长未知' : row.durationMinutes+' 分钟'} · ${row.distance === null ? '距离未知' : row.distance.value+' '+row.distance.unit}`;

export function TrainingCalendar({records,onOpenRecord}:TrainingCalendarProps) {
  const data = useMemo(() => adaptTrainingRecords(records),[records]);
  const [metric,setMetric] = useState<TrainingMetric>('sessions');
  const [range,setRange] = useState('recent');
  const [drill,setDrill] = useState<string|null>(null);
  const [mobile,setMobile] = useState(false);
  useEffect(() => {const media = matchMedia('(max-width: 680px)'),change = () => setMobile(media.matches);change();media.addEventListener('change',change);return () => media.removeEventListener('change',change);},[]);

  const currentRange = range === 'recent' || data.years.includes(range) ? range : 'recent';
  const dateRange = useMemo(() => trainingCalendarRange(data,currentRange),[data,currentRange]);
  const days = useMemo(() => data.daily.filter(day => dateRange && day.date >= dateRange.start && day.date <= dateRange.end),[data,dateRange]);
  const availableMetrics = useMemo(() => (['sessions',...(days.some(day => day.duration_min !== null) ? ['duration_min'] : []),...(days.some(day => day.distances.km !== null && day.distances.km !== undefined) ? ['distance_km'] : []),...(days.some(day => day.distances.mi !== null && day.distances.mi !== undefined) ? ['distance_mi'] : [])] as TrainingMetric[]),[days]);
  const currentMetric = availableMetrics.includes(metric) ? metric : 'sessions';
  const trainedDates = useMemo(() => new Set(days.map(day => day.date)),[days]);
  const calendarData = useMemo(() => trainingCalendarCells(days,currentMetric),[days,currentMetric]);

  const openDay = useCallback((datestr:string) => {
    if (!trainedDates.has(datestr)) return;
    const ids = trainingDayRecordIds(data,datestr);
    if (ids.length === 1) onOpenRecord(ids[0]);
    else if (ids.length > 1) setDrill(datestr);
  },[data,trainedDates,onOpenRecord]);
  const onHeatmapClick = useCallback((params:unknown) => {const datestr = trainingCalendarClickDate(params);if (datestr) openDay(datestr);},[openDay]);
  const metricLabel = trainingMetricLabels[currentMetric];
  const rangeDays = dateRange ? Math.round((Date.parse(dateRange.end)-Date.parse(dateRange.start))/86_400_000)+1 : 0;
  const height = mobile ? Math.ceil(rangeDays/7)*22+120 : 254;

  // Retains the upstream calendar/visualMap/heatmap option structure. Dimension 1
  // is an actual session count; null metric values get a neutral color, never zero.
  const option = useCallback((theme:ChartTheme) => ({
    aria:{enabled:true,label:{description:`已读运动日历，${days.length} 个有完成记录的日期。空白日期表示没有已读记录。可通过下方列表打开同一条详情。`}},
    tooltip:{renderMode:'richText',backgroundColor:theme.surface,borderColor:theme.border,textStyle:{color:theme.foreground},formatter:(params:unknown) => {
      const date = trainingCalendarClickDate(params),day = days.find(day => day.date === date);if (!day) return '无已读记录';
      const value = trainingMetricValue(day,currentMetric);
      return `${day.date}\n${metricLabel}：${value === null ? '未知 / 无此单位记录' : value}\n${day.records.map(row => row.title).join('\n')}\n点击查看记录`;
    }},
    visualMap:{min:0,max:Math.max(...calendarData.flatMap(cell => cell.value === null ? [] : [cell.value]),1),dimension:2,calculable:false,orient:'horizontal',left:'center',bottom:0,inRange:{color:[theme.selected,theme.primary]},text:['较多','较少'],textStyle:{color:theme.muted}},
    calendar:{top:mobile ? 48 : 42,left:mobile ? 38 : 54,right:18,bottom:58,orient:mobile ? 'vertical' : 'horizontal',cellSize:['auto',mobile ? 22 : 20],range:dateRange ? [dateRange.start,dateRange.end] : [],itemStyle:{color:theme.surface,borderWidth:2,borderColor:theme.border},dayLabel:{firstDay:1,nameMap:['日','一','二','三','四','五','六'],color:theme.muted,fontSize:12},monthLabel:{nameMap:'ZH',color:theme.muted,fontSize:12},yearLabel:{show:false}},
    series:[{type:'heatmap',coordinateSystem:'calendar',dimensions:[{name:'date',type:'time'},{name:'sessions',type:'number'},{name:'metric',type:'number'}],encode:{time:0,value:1},data:calendarData.map(cell => ({value:[cell.date,cell.sessions,cell.value],...(cell.value === null ? {itemStyle:{color:theme.unknown}} : {})})),cursor:'pointer'}],
  }),[calendarData,currentMetric,days,metricLabel,mobile,dateRange]);
  const recent = useMemo(() => data.completed.filter(row => row.date === null || dateRange && row.date >= dateRange.start && row.date <= dateRange.end).toSorted((a,b) => (b.date ?? '').localeCompare(a.date ?? '') || a.id.localeCompare(b.id)).slice(0,30),[data,dateRange]);
  const selectedDay = drill ? days.find(day => day.date === drill) : null;

  return <section className={s.root} aria-label="运动日历与记录">
    <header className={s.header}><h2>运动日历</h2>{data.years.length > 0 && <label>查看范围<select value={currentRange} onChange={event => {setRange(event.target.value);setDrill(null);}}><option value="recent">最近90天</option>{data.years.map(year => <option key={year} value={year}>{year} 年</option>)}</select></label>}</header>
    <p className={s.hint}>已读 {data.n_sessions} 条完成记录 · {data.n_days} 个有日期的运动日 · {data.planned.length} 条计划单独保留{data.undated.length ? ` · ${data.undated.length} 条完成记录日期未知` : ''}。</p>
    <TrainingAnalyticsPanel />
    {!data.n_sessions ? <p className={s.empty}>暂无已完成的运动记录。飞盘、跑步、力量训练等都可记录；已有计划不会当作完成。</p> : <>
      {dateRange ? <div className={s.panel}>
        <div className={s.metrics} aria-label="日历指标">{availableMetrics.map(m => <Button key={m} type="button" variant={currentMetric === m ? 'secondary' : 'ghost'} size="sm" aria-pressed={currentMetric === m} onClick={() => setMetric(m)}>{trainingMetricLabels[m]}</Button>)}</div>
        <h3>运动热力图 · {metricLabel}</h3>
        <p className={s.hint}>{dateRange.start} 至 {dateRange.end}{currentRange === 'recent' ? '（截至最新已读日期）' : ''}。空白日期只表示无已读记录；灰色实块表示有记录但此指标未知，缺失不补零。距离按原单位分别查看。</p>
        <Chart height={height} onEvents={{click:onHeatmapClick}} option={option}/>
        {selectedDay && <div className={s.dayRecords} role="group" aria-label={selectedDay.date+' 的运动记录'}><div className={s.header}><h3>{selectedDay.date} · {selectedDay.records.length} 条记录</h3><Button type="button" variant="ghost" size="sm" onClick={() => setDrill(null)}>收起当日记录</Button></div>{selectedDay.records.map(row => <Button type="button" key={row.id} variant="outline" className={s.dayRecord} onClick={() => onOpenRecord(row.id)}><span>{row.title}</span><small>{recordMetrics(row)}</small></Button>)}</div>}
      </div> : <p className={s.empty}>已完成记录的日期尚未填写，补充日期后可查看日历。</p>}
      <div className={s.panel}>
        <h3>最近已读运动</h3><p className={s.hint}>当前范围内最近30条记录；点击名称打开原记录。计划不计入这张表。</p>
        <div className={s.tableWrap}><table className={s.table}><thead><tr><th scope="col">日期</th><th scope="col">运动与原始记录</th></tr></thead><tbody>{recent.map(row => <tr key={row.id}><td>{row.date ?? '日期未知'}</td><td><Button type="button" variant="link" className={s.recordButton} onClick={() => onOpenRecord(row.id)}>{row.title}</Button><p className={s.hint}>{recordMetrics(row)}</p></td></tr>)}</tbody></table></div>
        {!recent.length && <p className={s.empty}>当前范围内无已读完成记录。</p>}
      </div>
    </>}
  </section>;
}
