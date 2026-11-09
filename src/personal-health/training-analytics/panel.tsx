'use client';

import {type ChangeEvent,useId,useMemo,useRef,useState} from 'react';
import {Button} from '../../ui-review/ui/button';
import {
  aggregateTrainingAnalytics,
  parseTrainingAnalyticsSnapshot,
  trainingMuscles,
  type TrainingAnalyticsSnapshot,
  type TrainingGrain,
  type TrainingMuscle,
} from './model';
import styles from './panel.module.css';

const grainLabels = {day:'日',week:'周',month:'月',quarter:'季度',year:'年'} satisfies Record<TrainingGrain,string>;
const grains = Object.keys(grainLabels) as TrainingGrain[];
const muscleLabels = {
  chest:'胸',back:'背',shoulders:'肩',biceps:'肱二头肌',triceps:'肱三头肌',
  quadriceps:'股四头肌',hamstrings:'腘绳肌',glutes:'臀',calves:'小腿',core:'核心',
} satisfies Record<TrainingMuscle,string>;

const maxFileBytes = 16 * 1024 * 1024;
const recentPoints = 12;
const numberFormat = new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2});
const dayStatus = {complete:'完整',partial:'部分可读',unavailable:'未知'} as const;
const metrics = {sets:'完成组数',kilograms:'公斤容量',pounds:'磅容量',coverage:'肌群覆盖'} as const;

type Point = ReturnType<typeof aggregateTrainingAnalytics>[number];
type Day = TrainingAnalyticsSnapshot['days'][number];
type Metric = keyof typeof metrics;
type Scope = 'all' | TrainingMuscle;

function quantities(point: Point, scope: Scope) {
  if (scope === 'all') return point;
  const value = point.muscles[scope];
  const noMatchingSets = point.completeDays === point.totalDays && point.unmappedSets === 0 ? 0 : null;
  return value ?? {sets:noMatchingSets,kilograms:null,pounds:null};
}

function quantity(value: number | null, unit: string) {
  return value === null ? '未知' : `${numberFormat.format(value)} ${unit}`;
}

function hasIncompleteCoverage(point: Point) {
  return point.completeDays < point.totalDays || point.unmappedSets > 0;
}

function metricValue(point: Point, scope: Scope, metric: Metric) {
  if (metric === 'coverage') return point.sets === null ? null : Object.keys(point.muscles).length;
  return quantities(point,scope)[metric];
}

function trendLabel(point: Point, value: number | null, metric: Metric) {
  if (metric === 'coverage') {
    const total = trainingMuscles.length;
    if (value === null) return `未知 / ${total}`;
    const lowerBound = value < total && hasIncompleteCoverage(point) ? '至少 ' : '';
    return `${lowerBound}${value} / ${total}`;
  }
  return quantity(value,{sets:'组',kilograms:'kg',pounds:'lb'}[metric]);
}

function periodLabel(point: Point) {
  return point.start === point.end ? point.start : `${point.start} 至 ${point.end}`;
}

function completedExercises(day: Day, scope: Scope) {
  const rows = new Map<string,{exercise:string,muscle:TrainingMuscle|null,sets:number}>();
  for (const set of day.sets) {
    if (scope !== 'all' && scope !== set.muscle) continue;
    const key = JSON.stringify([set.exercise,set.muscle]);
    const row = rows.get(key);
    if (row) row.sets += 1;
    else rows.set(key,{exercise:set.exercise,muscle:set.muscle,sets:1});
  }
  return rows;
}

export function TrainingAnalyticsPanel() {
  const [source,setSource] = useState<TrainingAnalyticsSnapshot | null>(null);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const [grain,setGrain] = useState<TrainingGrain>('week');
  const [scope,setScope] = useState<Scope>('all');
  const [metric,setMetric] = useState<Metric>('sets');
  const [periodKey,setPeriodKey] = useState('');
  const [dayKey,setDayKey] = useState('');
  const fileHintId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingRead = useRef(0);

  const points = useMemo(() => source ? aggregateTrainingAnalytics(source,grain) : [],[source,grain]);
  const point = points.find(item => item.key === periodKey)
    ?? points.findLast(item => (item.sets ?? 0) > 0)
    ?? points.at(-1);
  const selectedDays = point?.days ?? [];
  const day = selectedDays.find(item => item.date === dayKey)
    ?? selectedDays.findLast(item => item.sets.length > 0)
    ?? selectedDays.at(-1);

  function clearFile() {
    pendingRead.current += 1;
    setSource(null);
    setLoading(false);
    setError('');
    if (fileInput.current) fileInput.current.value = '';
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const request = ++pendingRead.current;
    setSource(null);
    setError('');
    if (file.size > maxFileBytes) {
      setLoading(false);
      event.currentTarget.value = '';
      setError('文件超过 16 MiB。请选用较小日期范围的训记分析文件。');
      return;
    }
    setLoading(true);
    try {
      const contents = await file.text();
      if (request !== pendingRead.current) return;
      const snapshot = parseTrainingAnalyticsSnapshot(JSON.parse(contents));
      setPeriodKey('');
      setDayKey('');
      setSource(snapshot);
    } catch {
      if (request !== pendingRead.current) return;
      if (fileInput.current) fileInput.current.value = '';
      setError('无法读取这份文件。请选择 LifeOS 生成的训记分析 JSON。');
    } finally {
      if (request === pendingRead.current) setLoading(false);
    }
  }

  function selectPeriod(key: string) {
    setPeriodKey(key);
    setDayKey('');
  }

  const pointIndex = point ? points.indexOf(point) : -1;
  const shownPoints = points.slice(Math.max(0,pointIndex - recentPoints + 1),pointIndex + 1);
  const chartMax = metric === 'coverage' ? trainingMuscles.length : Math.max(1,...shownPoints.map(item => metricValue(item,scope,metric) ?? 0));
  const value = point && quantities(point,scope);
  const muscleRank = point ? trainingMuscles
    .filter(muscle => (point.muscles[muscle]?.sets ?? 0) > 0)
    .map(muscle => ({muscle,sets:point.muscles[muscle]!.sets}))
    .sort((a,b) => b.sets - a.sets) : [];
  const coverageIsPartial = point && hasIncompleteCoverage(point);
  const coveredMuscles = point?.sets === null ? '未知' : muscleRank.length;
  const exercises = day ? completedExercises(day,scope) : null;

  return <section className={styles.root} aria-label="训练日记分析">
    <header className={styles.header}>
      <div>
        <h2>训练日记分析</h2>
        <p className={styles.hint}>选择训记分析文件，查看训练量和肌群覆盖。文件仅在此页面内分析，关闭页面或清除后释放。</p>
      </div>
      {(source || loading) && <Button type="button" variant="outline" onClick={clearFile}>清除本次数据</Button>}
    </header>

    <div className={styles.fileRow}>
      <label className={styles.fileControl}>
        <span>选择训记分析文件</span>
        <input ref={fileInput} type="file" accept=".json,application/json" aria-describedby={fileHintId} onChange={event => void readFile(event)}/>
      </label>
      <p id={fileHintId} className={styles.hint}>LifeOS 生成的分析 JSON，最大 16 MiB。来源为训记已读完成组。 <a href="https://github.com/Nirvana-Chow/lifeos-app#训记训练分析文件">文件准备方法</a></p>
    </div>
    {loading && <p role="status" className={styles.hint}>正在读取本地文件…</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {source && !point && <p className={styles.hint}>这份文件没有可供分析的日期。</p>}

    {point && value && <>
      <div className={styles.controls}>
        <div className={styles.grains} role="group" aria-label="统计周期">
          {grains.map(item => <Button type="button" key={item} variant={item === grain ? 'secondary' : 'ghost'}
            aria-pressed={item === grain} onClick={() => {setGrain(item);selectPeriod('');}}>{grainLabels[item]}</Button>)}
        </div>
        <label className={styles.select}>统计范围
          <select value={scope} onChange={event => setScope(event.target.value as Scope)}>
            <option value="all">全部肌群</option>
            {trainingMuscles.map(muscle => <option key={muscle} value={muscle}>{muscleLabels[muscle]}</option>)}
          </select>
        </label>
        <label className={styles.select}>所选周期
          <select value={point.key} onChange={event => selectPeriod(event.target.value)}>
            {points.map(item => <option key={item.key} value={item.key}>{periodLabel(item)}</option>)}
          </select>
        </label>
      </div>

      <section className={styles.summary} aria-label="所选周期概览">
        <h3>{periodLabel(point)}</h3>
        <dl className={styles.stats}>
          <div><dt>完成组数</dt><dd>{quantity(value.sets,'组')}</dd></div>
          <div>
            <dt>已读肌群覆盖</dt><dd>{coveredMuscles} / {trainingMuscles.length}</dd>
            {coverageIsPartial && coveredMuscles !== '未知' && coveredMuscles < trainingMuscles.length && <small className={styles.hint}>实际覆盖可能更多</small>}
          </div>
          <div><dt>已知公斤容量</dt><dd>{quantity(value.kilograms,'kg')}</dd></div>
          <div><dt>已知磅容量</dt><dd>{quantity(value.pounds,'lb')}</dd></div>
        </dl>
        <p className={styles.hint}>
          {point.completeDays} 天完整 · {point.partialDays} 天部分可读 · {point.totalDays - point.completeDays - point.partialDays} 天未知。
          {point.unmappedSets > 0 ? ` ${point.unmappedSets} 组肌群待归类。` : ''}
          {point.unweightedSets > 0 ? ` ${point.unweightedSets} 组未纳入外负荷容量。` : ''}
        </p>
        <p className={styles.hint}>容量累加重量、单位与次数明确的训练组，递减组追加段不计。公斤与磅分开。覆盖按完成组的主要肌群统计。</p>
        {muscleRank.length > 0 && <ul className={styles.muscles} aria-label="本周期肌群与完成组数">
          {muscleRank.map(({muscle,sets}) => <li key={muscle}><span>{muscleLabels[muscle]}</span><strong>{sets} 组</strong></li>)}
        </ul>}
      </section>

      <section className={styles.detail} aria-label="训练量趋势">
        <header className={styles.header}>
          <div>
            <h3>训练量趋势</h3>
            <p className={styles.hint}>截至所选周期，最多比较最近 {recentPoints} 个同粒度周期。{metric === 'coverage' ? '肌群覆盖按全部肌群统计。' : ''}</p>
          </div>
          <label className={styles.select}>指标
            <select value={metric} onChange={event => setMetric(event.target.value as Metric)}>
              {Object.entries(metrics).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
        </header>
        <ol className={styles.trend}>
          {shownPoints.map(item => {
            const measure = metricValue(item,scope,metric);
            return <li key={item.key}>
              <button type="button" aria-pressed={item.key === point.key} onClick={() => selectPeriod(item.key)}>
                <span className={styles.trendDate}>{periodLabel(item)}</span>
                <span className={styles.track} aria-hidden="true">{measure !== null && <span style={{width:`${measure / chartMax * 100}%`}}/>}</span>
                <span className={styles.measure}>{trendLabel(item,measure,metric)}</span>
                <small className={styles.hint}>{item.completeDays} / {item.totalDays} 天完整</small>
              </button>
            </li>;
          })}
        </ol>
      </section>

      <section className={styles.detail} aria-label="日期明细">
        <header className={styles.header}>
          <h3>日期明细</h3>
          {day && <label className={styles.select}>查看日期
            <select value={day.date} onChange={event => setDayKey(event.target.value)}>
              {selectedDays.map(item => <option key={item.date} value={item.date}>{item.date} · {dayStatus[item.status]}</option>)}
            </select>
          </label>}
        </header>
        {day && exercises?.size ? <>
          <p className={styles.hint}>{day.date} · 来源{dayStatus[day.status]}。按日查看当日训练量和肌群覆盖。</p>
          <ul className={styles.exercises}>
            {Array.from(exercises,([key,row]) => <li key={key}>
              <strong>{row.exercise}</strong><span>{row.muscle ? muscleLabels[row.muscle] : '肌群待归类'} · {row.sets} 组</span>
            </li>)}
          </ul>
        </> : <p className={styles.hint}>{day?.status === 'complete' ? '当日没有符合当前范围的已读完成组。' : '当前范围缺少可展示的当日完成组，实际训练仍未知。'}</p>}
      </section>
    </>}
  </section>;
}
