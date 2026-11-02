'use client';

import { useMemo } from 'react';
import { useTable, type ColumnDef, type HeaderContext } from '@tanstack/react-table';
import { DataGrid, DataGridContainer, dataGridFeatures } from './reui/data-grid';
import { DataGridTableVirtual } from './reui/data-grid-table-virtual';
import { Button } from './ui/button';
import styles from './record-grid.module.css';

// Fixed read-only business projection, not a task/save adapter or configurable schema.
type RecordGridRow = {
  id: string;
  kind: string;
  title: string;
  domain: string;
  project: string;
  status: string;
  stage?: string;
};
type Projection = 'persistent' | 'synthetic';
const fields = ['kind', 'title', 'domain', 'project', 'status', 'stage'] as const;
const labels = {
  persistent: ['类型', '项目 / 待办', '领域', '项目', '状态', '项目阶段'],
  synthetic: ['类别', '项目 / 待办', '领域', '所属项目', '状态'],
};
const widths = {
  persistent: [80, 230, 160, 180, 100, 100],
  synthetic: [80, 250, 100, 220, 100],
};

function RecordHeader({ column }: HeaderContext<typeof dataGridFeatures, RecordGridRow, unknown>) {
  const label = column.columnDef.meta?.headerTitle;
  if (!column.getCanSort()) return label;
  return (
    <Button variant="ghost" className={styles.sort} onClick={column.getToggleSortingHandler()} aria-label={`按${label}排序`}>
      {label}<span aria-hidden="true">{column.getIsSorted() === 'asc' ? '↑' : column.getIsSorted() === 'desc' ? '↓' : ''}</span>
    </Button>
  );
}

export function RecordGrid({ rows, projection }: { rows: readonly RecordGridRow[]; projection: Projection }) {
  const columns = useMemo<ColumnDef<typeof dataGridFeatures, RecordGridRow>[]>(() =>
    labels[projection].map((label, index) => ({
      id: fields[index],
      accessorKey: fields[index],
      size: widths[projection][index],
      minSize: widths[projection][index],
      enableSorting: fields[index] === 'title' || fields[index] === 'domain',
      header: RecordHeader,
      cell: ({ getValue }) => <span className={styles.value}>{String(getValue() ?? '')}</span>,
      meta: { headerTitle: label, cellClassName: styles.cell },
    })), [projection]);
  const data = useMemo(() => [...rows], [rows]);
  const table = useTable({
    features: dataGridFeatures,
    columns,
    data,
    getRowId: row => row.id,
    state: { pagination: { pageIndex: 0, pageSize: Math.max(data.length, 1) } },
    enableRowSelection: false,
    autoResetPageIndex: false,
  });

  return (
    <div className={styles.root} aria-label="项目与行动只读表格" data-record-grid="reui">
      <DataGridContainer>
        <DataGrid table={table} recordCount={rows.length}
          i18n={{ labels: { empty: '当前筛选没有记录', loading: '正在加载表格…', allRowsLoaded: '已显示全部记录' } }}
          tableLayout={{ width: 'fixed', cellSelection: false }}
          tableClassNames={{ base: styles.table, headerRow: styles.header, bodyRow: styles.row }}>
          <DataGridTableVirtual height={370} estimateSize={48} overscan={10} />
        </DataGrid>
      </DataGridContainer>
    </div>
  );
}
