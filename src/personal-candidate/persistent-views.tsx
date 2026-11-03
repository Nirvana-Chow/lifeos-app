'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PublicEntry } from '../platform/contracts';
import { projectRows, taskStats } from './projection';
import { resources } from '../component-review/resources';
import { RecordGrid } from '../ui-review/record-grid';
import s from '../component-review/workspace.module.css';

export function PersistentViews({ entries, spaceId, layoutOnly = false, navigationLocked = false, documentNavigation = false }: {
  entries: PublicEntry[];
  spaceId: string;
  layoutOnly?: boolean;
  navigationLocked?: boolean;
  documentNavigation?: boolean;
}) {
  const [domain, setDomain] = useState('全部');
  const [kind, setKind] = useState('全部');
  const [error, setError] = useState('');
  const [themeRevision, setThemeRevision] = useState(0);
  const chart = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => projectRows(entries, spaceId, new Date().toLocaleDateString('sv-SE')), [entries, spaceId]);
  const filtered = useMemo(() => rows.filter(row =>
    (domain === '全部' || (row.domainId ?? '__unclassified__') === domain) && (kind === '全部' || row.kind === kind)), [rows, domain, kind]);
  const stats = taskStats(filtered);
  const RecordLink = documentNavigation ? 'a' : Link;

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeRevision(value => value + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-lifeos-theme'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    const scope = resources();
    setError('');
    void Promise.all([import('echarts/core'), import('echarts/charts'), import('echarts/components'), import('echarts/renderers')])
      .then(([e, c, components, renderers]) => {
        if (cancelled || !chart.current) return;
        e.use([c.PieChart, components.TooltipComponent, components.LegendComponent, components.AriaComponent, renderers.SVGRenderer]);
        const color = getComputedStyle(chart.current).color;
        const channels = (color.match(/\d+(?:\.\d+)?/g) ?? []).slice(0, 3).map(Number);
        const dark = channels.length === 3 ? (channels[0] + channels[1] + channels[2]) / 3 > 128 : document.documentElement.dataset.lifeosTheme === 'dark';
        const graph = e.init(chart.current, dark ? 'dark' : undefined, { renderer: 'svg' });
        scope.add(() => graph.dispose());
        graph.setOption({
          aria: { enabled: true }, tooltip: { trigger: 'item' }, legend: { bottom: 0 },
          series: [{ type: 'pie', radius: ['35%', '60%'], data: stats.total ? [
            { name: '已完成', value: stats.done }, { name: '未完成', value: stats.open }, { name: '已取消', value: stats.cancelled },
          ] : [] }],
        });
        const observer = new ResizeObserver(() => graph.resize());
        scope.add(() => observer.disconnect());
        observer.observe(chart.current);
      }).catch(() => {
        scope.release();
        if (!cancelled) setError('图表组件加载失败，仍可查看同源卡片。');
      });
    return () => { cancelled = true; scope.release(); };
  }, [stats.open, stats.done, stats.cancelled, stats.total, themeRevision]);

  return (
    <section className={s.panel}>
      <h2>项目与行动总览</h2>
      <p>{layoutOnly ? '空白布局检查 · 未加载账户或业务数据，以下不是本人统计。' : '待评审候选 · 当前空间全量快照，最多 10,000 条；超过上限会报错，不显示部分统计。'}</p>
      <div className={s.controls}>
        <label>领域筛选<select value={domain} onChange={event => setDomain(event.target.value)}>
          <option value="全部">全部</option>
          {[...new Map(rows.map(row => [row.domainId ?? '__unclassified__', { id: row.domainId ?? '__unclassified__', title: row.domain }])).values()]
            .map(value => <option key={value.id} value={value.id}>{value.title}{value.id === '__unclassified__' ? '' : ' · ' + value.id.slice(0, 6)}</option>)}
        </select></label>
        <label>类别筛选<select value={kind} onChange={event => setKind(event.target.value)}>
          {['全部', '项目', '领域', '待办', '日记', '主题'].map(value => <option key={value}>{value}</option>)}
        </select></label>
      </div>
      <p aria-live="polite">{stats.done} 已完成 · {stats.open} 未完成 · {stats.cancelled} 已取消 · {stats.overdue} 逾期 · {stats.total} 项任务</p>
      <p>逾期是未完成的子集；项目状态独立维护。表格、图表和卡片共用相同记录 ID 和修订。</p>
      <div className={s.chart} ref={chart} aria-label="ECharts 持久化记录统计" />
      {error && <p role="alert">{error}</p>}
      <div className={s.desktop}><h3>ReUI 同源表格</h3><RecordGrid rows={filtered} projection="persistent" /></div>
      <div className={s.cards}>{filtered.map(row => (
        <article key={row.id}>
          <h3>{navigationLocked ? <span>{row.title}</span> : <RecordLink href={'/personal/edit?type=' + encodeURIComponent(row.recordType) + '&id=' + row.id}>{row.title}</RecordLink>}</h3>
          <p>{row.sourceLabel}</p>
          <p>{row.kind} · {row.domain} · {row.status}{row.overdue ? ' · 逾期' : ''}</p>
          {row.kind === '项目' && <p>阶段 {row.stage} · 用途 {({ maintain: '维系', advance: '推进', explore: '探索' } as Record<string, string>)[row.purpose] ?? '未选'}<br />下一步：{row.nextStep || '未填写'}</p>}
          {row.referenceChanged && <p>关联来源已变化或不可读取，旧引用需要重新核对。</p>}
          <p>版本 {row.revision}</p>
        </article>
      ))}</div>
      {!filtered.length && <p>当前筛选没有记录，不计算完成率。</p>}
    </section>
  );
}
