'use client';

import {useDeferredValue,useId,useMemo,useState} from 'react';
import type {TrainingAnalyticsSnapshot} from '../training-analytics/model';
import {buildExerciseLibrary,filterExerciseLibrary} from './model';
import s from './library.module.css';

const pageSize = 24;

export function ExerciseLibrary({source}:{source?:TrainingAnalyticsSnapshot|null}) {
  const id = useId();
  const [query,setQuery] = useState('');
  const [shown,setShown] = useState(pageSize);
  const deferredQuery = useDeferredValue(query);
  const rows = useMemo(() => buildExerciseLibrary(source),[source]);
  const filtered = useMemo(() => filterExerciseLibrary(rows,deferredQuery),[rows,deferredQuery]);
  const observedCount = rows.filter(row => row.observed !== null).length;
  const guideCount = rows.filter(row => row.guide !== null).length;

  return <section className={s.root} aria-label="动作资料库">
    <details>
      <summary><h3>动作资料库</h3><span>{guideCount} 条用途资料{observedCount ? ` · 本次已读 ${observedCount} 个动作` : ''}</span></summary>
      <div className={s.content}>
        <p className={s.hint}>查看动作练什么，并打开原始教程。资料逐步补充；已读动作优先显示。</p>
        {!source && <p className={s.hint}>尚未载入训练文件，以下只展示动作资料。</p>}
        <label className={s.search} htmlFor={id}>搜索动作或训练目的
          <input id={id} type="search" value={query} onChange={event => {setQuery(event.target.value);setShown(pageSize);}} placeholder="例如：鸟狗式、核心、腘绳肌"/>
        </label>
        <p className={s.hint} role="status">找到 {filtered.length} 个动作{filtered.length > shown ? `，先显示 ${shown} 个` : ''}。</p>
        {filtered.length ? <ul className={s.list}>{filtered.slice(0,shown).map(row => <li key={row.name}>
          <h4>{row.name}</h4>
          <p>{row.guide?.purpose ?? '用途资料待补充，暂不推断这个动作的训练目标。'}</p>
          {row.observed && <p className={s.hint}>本次文件已读 {row.observed.sets} 个完成组 · 最近日期 {row.observed.lastDate}</p>}
          {row.guide && <a href={row.guide.source.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{row.guide.source.label}<span className={s.srOnly}>：{row.name}（在新标签页打开）</span></a>}
        </li>)}</ul> : <p className={s.hint}>没有匹配的动作，试试动作名或训练部位。</p>}
        {filtered.length > shown && <button type="button" className={s.more} onClick={() => setShown(value => value+pageSize)}>再显示 {Math.min(pageSize,filtered.length-shown)} 个</button>}
        <p className={s.hint}>用途说明关联现有精确动作名，不代表本人练过或已掌握。完成组仅来自本次已读文件，未出现的动作保持未知。</p>
      </div>
    </details>
  </section>;
}
