"use client";

import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTable, type CellContext, type HeaderContext, type ColumnDef } from '@tanstack/react-table';
import type { TaskGridProps, TaskRow } from './contract';
import type { TaskCellDraft, TaskCellField } from '../personal-candidate/task-cell-draft';
import { taskStatusLabels } from '../personal-candidate/task-editor-state';
import { mountTaskGridEditor } from '../personal-candidate/task-grid-editor';
import { DataGrid, DataGridContainer, dataGridFeatures } from './reui/data-grid';
import { DataGridTableVirtual } from './reui/data-grid-table-virtual';
import { DataGridCellSelection, type DataGridCellSelectionApi } from './reui/data-grid-cell-selection';
import { Button } from './ui/button';
import styles from './task-grid.module.css';

type CellEdit = TaskCellDraft & { writeDraft: (draft: TaskCellDraft | null) => void };
const editableFields: readonly TaskCellField[] = ['title', 'status', 'due'];
const columnLabels = ['待办', '状态', '到期日', '项目', '领域', '详情'];
const columnIds = ['title', 'status', 'due', 'project', 'area', 'detail'];
const columnWidths = [284, 176, 176, 150, 130, 114];
const valueOf = (task: TaskRow, field: TaskCellField) =>
  field === 'title' ? task.title : field === 'due' ? task.dueOn ?? '' : taskStatusLabels[task.status];
const canWrite = (props: TaskGridProps) =>
  !!props.writable && !props.blocked && !!props.onSave && !!props.getTaskFields;

function TaskGridInput({ edit, latest, close, advance, onError }: {
  edit: CellEdit;
  latest: { current: TaskGridProps };
  close: () => void;
  advance: (direction: 'next' | 'previous') => void;
  onError: (message: string) => void;
}) {
  const retained = latest.current.draftMemory?.read();
  const restored = retained?.task.id === edit.task.id && retained.task.revision === edit.task.revision && retained.field === edit.field ? retained : null;
  const input = useRef<HTMLInputElement | HTMLSelectElement>(null);
  const bridge = useRef<ReturnType<typeof mountTaskGridEditor> | null>(null);
  useEffect(() => {
    if (!input.current) return;
    const controller = mountTaskGridEditor(input.current, {
      ...edit,
      ...(restored ?? {}),
      canSave: () => canWrite(latest.current),
      save: (task, fields) => latest.current.onSave?.(task, fields) ?? Promise.resolve(null),
      onDraft: edit.writeDraft,
      onClose: close,
      onError,
      onAdvance: advance,
    });
    bridge.current = controller;
    const memory = latest.current.draftMemory;
    const unregister = memory?.registerCapture(controller.captureDraft);
    const unconfirm = memory?.onConfirmed(() => {
      // The memory already matched the authoritative receipt to this exact draft.
      controller.confirm();
    });
    return () => {
      controller.dispose();
      unregister?.();
      unconfirm?.();
      bridge.current = null;
    };
  }, [edit, latest, close, advance, onError]);
  useEffect(() => { bridge.current?.refreshAccess(); });
  const label = `编辑${columnLabels[editableFields.indexOf(edit.field)]}`;
  if (edit.field === 'status') {
    return (
      <select ref={node => { input.current = node; }} className={styles.input} aria-label={label} defaultValue={restored?.value ?? edit.value}>
        {Object.values(taskStatusLabels).map(label => <option key={label}>{label}</option>)}
      </select>
    );
  }
  return <input ref={node => { input.current = node; }} className={styles.input} aria-label={label} type={edit.field === 'due' ? 'date' : 'text'} defaultValue={restored?.value ?? edit.value} />;
}

type GridCellState = {
  edit: CellEdit | null;
  latest: { current: TaskGridProps };
  open: (rowId: string, field: TaskCellField, initialText?: string) => void;
  close: () => void;
  advance: (direction: 'next' | 'previous') => void;
  onError: (message: string) => void;
};
const GridCellContext = createContext<GridCellState | null>(null);

// Component types stay stable across saving/uncertain/access transitions. Context updates
// reach the editor through upstream memoized rows without resetting the native input.
function TaskGridValueCell({ row, column, getValue }: CellContext<typeof dataGridFeatures, TaskRow, unknown>) {
  const state = useContext(GridCellContext);
  if (!state) throw Error('Task cell requires its workspace context.');
  const { edit, latest, open, close, advance, onError } = state;
  const index = columnIds.indexOf(column.id);
  if (index >= 3) {
    return <Button variant="ghost" className={styles.open} data-cell-interactive disabled={latest.current.blocked}
      aria-label={index === 5 ? `打开任务：${row.original.title}` : `${columnLabels[index]}：${String(getValue())}，打开任务：${row.original.title}`}
      onClick={event => latest.current.onOpen(row.original, event.currentTarget)}><span>{String(getValue())}</span></Button>;
  }
  if (edit?.task.id === row.id && edit.field === column.id) {
    return <TaskGridInput edit={edit} latest={latest} close={close} advance={advance} onError={onError} />;
  }
  const value = column.id === 'status' ? taskStatusLabels[row.original.status] : String(getValue());
  return <span className={styles.cell} onDoubleClick={() => open(row.id, editableFields[index])}>{value || '—'}</span>;
}

function TaskGridColumnHeader({ column }: HeaderContext<typeof dataGridFeatures, TaskRow, unknown>) {
  const index = columnIds.indexOf(column.id);
  if (index === 5) return columnLabels[index];
  const direction = column.getIsSorted();
  return <Button variant="ghost" className={styles.sort} data-sorted={direction || undefined}
    onClick={column.getToggleSortingHandler()} aria-label={`按${columnLabels[index]}排序`}>
    {columnLabels[index]}<span className={styles.sortIndicator} aria-hidden="true">{direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕'}</span>
  </Button>;
}

/** Fixed free ReUI renderer, sharing the unchanged controller/receipt/draft boundary. */
export function TaskGrid(props: TaskGridProps) {
  const latest = useRef(props);
  latest.current = props;
  const host = useRef<HTMLDivElement>(null);
  const focusApi = useRef<DataGridCellSelectionApi | null>(null);
  const tableRef = useRef<ReturnType<typeof useTable<typeof dataGridFeatures, TaskRow>> | null>(null);
  const currentEdit = useRef<CellEdit | null>(null);
  const [edit, setEdit] = useState<CellEdit | null>(null);
  const [error, setError] = useState<string | null>(null);
  currentEdit.current = edit;
  const close = useCallback(() => {
    const previous = currentEdit.current;
    setEdit(null);
    setError(null);
    if (previous) focusApi.current?.focusCell(previous.task.id, previous.field);
  }, []);
  const open = useCallback((rowId: string, field: TaskCellField, initialText?: string) => {
    const current = latest.current;
    if (!canWrite(current)) return;
    if (currentEdit.current?.task.id === rowId && currentEdit.current.field === field) return;
    const task = current.tasks.find(row => row.id === rowId);
    if (!task) return;
    const fields = current.getTaskFields?.(task);
    if (!fields) return;
    const retained = current.draftMemory?.read();
    const restore = retained?.task.id === rowId && retained.field === field ? retained : null;
    const target: TaskCellDraft = restore ?? {
      task: { id: task.id, revision: task.revision }, fields: structuredClone(fields), field, value: valueOf(task, field),
    };
    const writeDraft = current.draftMemory?.claim(target.task, field, () => window.confirm('当前表格修改尚未保存，放弃这些修改并编辑另一单元格？'));
    if (current.draftMemory && !writeDraft) return;
    // Text replacement applies only to title. Native select/date cannot represent arbitrary first characters.
    // Resuming an existing draft preserves its text; a newly typed character continues it.
    const value = field === 'title' && initialText !== undefined ? restore ? restore.value + initialText : initialText : target.value;
    if (value !== target.value) writeDraft?.({ ...target, value });
    setError(null);
    setEdit({ ...target, value, writeDraft: writeDraft ?? (() => {}) });
  }, []);
  const advance = useCallback((direction: 'next' | 'previous') => {
    const previous = currentEdit.current;
    const rows = tableRef.current?.getRowModel().rows;
    if (!previous || !rows) return;
    const index = rows.findIndex(row => row.id === previous.task.id);
    const position = index * 6 + editableFields.indexOf(previous.field) + (direction === 'next' ? 1 : -1);
    if (position < 0 || position >= rows.length * 6) return;
    const row = rows[Math.floor(position / 6)];
    focusApi.current?.focusCell(row.id, columnIds[position % 6]);
  }, []);
  const onError = useCallback((message: string) => setError(message), []);
  const columns = useMemo<ColumnDef<typeof dataGridFeatures, TaskRow>[]>(() =>
    columnIds.map((id, index) => ({
      id,
      size: columnWidths[index],
      minSize: columnWidths[index],
      accessorFn: task => index === 1 ? task.status : index < 3 ? valueOf(task, editableFields[index]) : index === 3 ? task.project?.title ?? '—' : index === 4 ? task.area?.title ?? '—' : '查看详情',
      header: TaskGridColumnHeader,
      enableSorting: index < 5,
      meta: {
        headerTitle: columnLabels[index],
        cellClassName: styles.tableCell,
        ...(index < 3 ? { cellEdit: { editable: () => canWrite(latest.current) } } : {}),
      },
      cell: TaskGridValueCell,
    })), [latest]);
  const data = useMemo(() => [...props.tasks], [props.tasks]);
  const table = useTable({
    features: dataGridFeatures,
    data,
    columns,
    getRowId: row => row.id,
    initialState: { pagination: { pageIndex: 0, pageSize: Math.max(data.length, 1) } },
    state: { pagination: { pageIndex: 0, pageSize: Math.max(data.length, 1) } },
    enableRowSelection: false,
    autoResetPageIndex: false,
  });
  tableRef.current = table;
  const rowIds = table.getRowModel().rows.map(row => row.id);
  const retained = props.draftMemory?.read();
  const restoreIndex = retained ? rowIds.indexOf(retained.task.id) : -1;
  useEffect(() => {
    if (edit || !canWrite(latest.current)) return;
    const draft = latest.current.draftMemory?.read();
    if (draft && latest.current.tasks.some(row => row.id === draft.task.id)) open(draft.task.id, draft.field);
  }, [props.tasks, props.writable, props.blocked, edit, open]);
  useEffect(() => {
    if (edit && !props.tasks.some(row => row.id === edit.task.id)) setEdit(null);
  }, [props.tasks, edit]);

  return (
    <GridCellContext.Provider value={{ edit, latest, open, close, advance, onError }}>
    <div ref={host} className={styles.root} aria-label="待办表格" data-task-grid="reui">
      <DataGridContainer>
        <DataGrid table={table} recordCount={props.tasks.length}
          onCellEditRequest={request => {
            if (editableFields.includes(request.columnId as TaskCellField)) open(request.rowId, request.columnId as TaskCellField, request.initialText);
          }}
          i18n={{ labels: { empty: '没有符合条件的待办', loading: '正在加载表格…', allRowsLoaded: '已显示全部待办' } }}
          tableLayout={{ width: 'fixed', cellSelection: true, cellSelectionMode: 'single', cellEditMode: 'dblclick', cellFillHandle: false }}
          tableClassNames={{ base: styles.table, headerRow: styles.header, bodyRow: styles.row }}>
          <DataGridTableVirtual height={460} estimateSize={52} overscan={10} scrollToRowIndex={restoreIndex >= 0 ? restoreIndex : undefined} />
          <DataGridCellSelection apiRef={focusApi} clipboard={false} />
        </DataGrid>
      </DataGridContainer>
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
    </GridCellContext.Provider>
  );
}
