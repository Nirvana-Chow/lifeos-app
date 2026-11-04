'use client';

import { useMemo, type MouseEvent } from 'react';
import { useTable, type ColumnDef, type HeaderContext } from '@tanstack/react-table';
import type { AreaRow, ProjectRow, TaskRow } from './contract';
import { DataGrid, DataGridContainer, dataGridFeatures } from './reui/data-grid';
import { DataGridTableVirtual } from './reui/data-grid-table-virtual';
import { Button } from './ui/button';
import styles from './category-grid.module.css';

type CategoryGridProps = {
  kind: 'projects' | 'areas';
  areas: readonly AreaRow[];
  projects: readonly ProjectRow[];
  tasks: readonly TaskRow[];
  coverage: 'complete' | 'partial';
  writable: boolean;
  onViewTasks: (areaId: string | null, projectId: string | null) => void;
  onNavigate?: (href: string) => boolean | void;
};
type CategoryRow = AreaRow & {
  area?: ProjectRow['area'];
  stage?: string | null;
  nextStep?: string | null;
  referenceChanged?: boolean;
  pending: number | null;
  projects: number | null;
};
const stageLabels: Record<string, string> = { idea: '想法', planned: '计划', active: '进行中', paused: '暂停', closed: '结束' };
function CategoryHeader({ column }: HeaderContext<typeof dataGridFeatures, CategoryRow, unknown>) {
  const label = column.columnDef.meta?.headerTitle;
  if (!column.getCanSort()) return label;
  const direction = column.getIsSorted();
  return <Button variant="ghost" className={styles.sort} onClick={column.getToggleSortingHandler()} aria-label={`按${label}排序`}>
    {label}<span aria-hidden="true">{direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕'}</span>
  </Button>;
}

/** Browsing only. Creation and editing retain the existing personal editor and host guard. */
export function CategoryGrid({kind, areas, projects, tasks, coverage, writable, onViewTasks, onNavigate}: CategoryGridProps) {
  const isProject = kind === 'projects';
  const label = isProject ? '项目' : '领域';
  const type = isProject ? 'project' : 'domain';
  const guard = (href: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (onNavigate?.(href) === false) event.preventDefault();
  };
  const data = useMemo<CategoryRow[]>(() => {
    const pendingProjects = new Map<string, number>();
    const pendingAreas = new Map<string, number>();
    const projectCounts = new Map<string, number>();
    for (const project of projects) if (project.area) projectCounts.set(project.area.id, (projectCounts.get(project.area.id) ?? 0) + 1);
    for (const task of tasks) {
      if (task.status !== 'open' && task.status !== 'in_progress') continue;
      if (task.project) pendingProjects.set(task.project.id, (pendingProjects.get(task.project.id) ?? 0) + 1);
      if (task.area) pendingAreas.set(task.area.id, (pendingAreas.get(task.area.id) ?? 0) + 1);
    }
    return (isProject ? projects : areas).map(row => ({
      ...row,
      pending: coverage === 'complete' ? (isProject ? pendingProjects : pendingAreas).get(row.id) ?? 0 : null,
      projects: coverage === 'complete' ? projectCounts.get(row.id) ?? 0 : null,
    }));
  }, [isProject, areas, projects, tasks, coverage]);
  const columns = useMemo<ColumnDef<typeof dataGridFeatures, CategoryRow>[]>(() => {
    const specs = isProject
      ? [['title', '项目', 250], ['area', '领域', 160], ['stage', '阶段', 130], ['nextStep', '下一步', 260], ['pending', '未完待办', 120], ['actions', '操作', 200]] as const
      : [['title', '领域', 270], ['projects', '项目数', 130], ['pending', '未完待办', 130], ['actions', '操作', 200]] as const;
    return specs.map(([id, title, size]) => ({
      id, size, minSize: id === 'actions' ? 190 : 100,
      accessorFn: row => id === 'area' ? row.area?.title ?? '—' : id === 'stage' ? stageLabels[row.stage ?? ''] ?? '未设置' : id === 'actions' ? '' : row[id as 'title' | 'nextStep' | 'pending' | 'projects'],
      enableSorting: id !== 'actions',
      filterFn: (row, columnId, value: string) => id === 'area' ? row.original.area?.id === value : id === 'stage' ? row.original.stage === value : String(row.getValue(columnId) ?? '').toLocaleLowerCase().includes(value.trim().toLocaleLowerCase()),
      header: CategoryHeader,
      meta: {headerTitle: title, cellClassName: styles.cell},
      cell: ({row, getValue}) => {
        if (id === 'actions') {
          const href = `/personal/edit?type=${type}&id=${encodeURIComponent(row.original.id)}`;
          return <div className={styles.actions}>
            <Button variant="ghost" className={styles.action} onClick={() => onViewTasks(isProject ? null : row.original.id, isProject ? row.original.id : null)} aria-label={`查看待办：${row.original.title}`}>查看待办</Button>
            {writable && <a className={styles.action} href={href} onClick={guard(href)} aria-label={`编辑${label}：${row.original.title}`}>编辑</a>}
          </div>;
        }
        return <span className={styles.value} title={id === 'nextStep' ? row.original.nextStep ?? undefined : undefined}>
          {String(getValue() ?? '—') || '—'}
          {id === 'title' && row.original.referenceChanged && <span className={styles.changed} role="img" aria-label="关联待核对" title="关联记录已变化，请核对">!</span>}
        </span>;
      },
    }));
  }, [isProject, label, type, writable, onViewTasks, onNavigate]);
  const table = useTable({
    features: dataGridFeatures, data, columns, getRowId: row => row.id,
    state: {pagination: {pageIndex: 0, pageSize: Math.max(data.length, 1)}},
    enableRowSelection: false, autoResetPageIndex: false,
  });
  const createHref = `/personal/edit?type=${type}`;
  return <section className={styles.root} aria-label={`${label}表格`} data-category-grid="reui">
    <div className={styles.toolbar}>
      <label className={styles.field}>搜索{label}<input value={String(table.getColumn('title')?.getFilterValue() ?? '')} onChange={event => table.getColumn('title')?.setFilterValue(event.target.value)} placeholder={`按${label}标题搜索`} type="search" /></label>
      {isProject && <>
        <label className={styles.field}>领域<select value={String(table.getColumn('area')?.getFilterValue() ?? '')} onChange={event => table.getColumn('area')?.setFilterValue(event.target.value || undefined)}>
          <option value="">全部领域</option>{areas.map(area => <option value={area.id} key={area.id}>{area.title}</option>)}
        </select></label>
        <label className={styles.field}>阶段<select value={String(table.getColumn('stage')?.getFilterValue() ?? '')} onChange={event => table.getColumn('stage')?.setFilterValue(event.target.value || undefined)}>
          <option value="">全部阶段</option>{Object.entries(stageLabels).map(([value, title]) => <option value={value} key={value}>{title}</option>)}
        </select></label>
      </>}
      {writable && <a className={styles.create} href={createHref} onClick={guard(createHref)}>新建{label}</a>}
    </div>
    {coverage === 'partial' && <p className={styles.notice}>当前数据范围不完整，数量暂不统计（—）。</p>}
    <DataGridContainer>
      <DataGrid table={table} recordCount={table.getFilteredRowModel().rows.length}
        i18n={{labels: {empty: `没有符合条件的${label}`, loading: '正在加载表格…', allRowsLoaded: '已显示全部记录'}}}
        tableLayout={{width: 'fixed', columnsResizable: true, columnsResizeMode: 'onEnd', cellSelection: false}}
        tableClassNames={{base: styles.table, headerRow: styles.header, bodyRow: styles.row}}>
        <DataGridTableVirtual height={420} estimateSize={56} overscan={10}/>
      </DataGrid>
    </DataGridContainer>
  </section>;
}
