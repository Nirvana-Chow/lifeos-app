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
type FieldAccess = Pick<TaskGridProps, 'writable' | 'blocked' | 'onSave' | 'getTaskFields' | 'draftMemory'>;
const editableFields: readonly TaskCellField[] = ['title', 'status', 'due'];
const columnIds = ['complete','title','status','due','project','area','detail'];
const columnLabels:Record<string,string>={complete:'完成',title:'待办',status:'状态',due:'到期日',project:'项目',area:'领域',detail:'详情'};
const columnWidths:Record<string,number>={complete:64,title:284,status:154,due:154,project:150,area:130,detail:100};
const columnMinWidths:Record<string,number>={complete:56,title:140,status:112,due:130,project:90,area:90,detail:80};
type GridLayout={order:string[];visibility:Record<string,boolean>};
const defaultLayout=():GridLayout=>({order:[...columnIds],visibility:{}});
function readLayout(scope:string|null|undefined):GridLayout{
 if(!scope)return defaultLayout();
 try{const value=JSON.parse(window.localStorage.getItem('lifeos.task-columns.v1:'+scope)??'null');
  if(!value||!Array.isArray(value.order)||value.order.length!==columnIds.length||new Set(value.order).size!==columnIds.length||!value.order.every((id:unknown)=>typeof id==='string'&&columnIds.includes(id)))return defaultLayout();
  const visibility:Record<string,boolean>={};for(const id of columnIds)if(id!=='complete'&&id!=='title'&&typeof value.visibility?.[id]==='boolean')visibility[id]=value.visibility[id];
  return {order:value.order,visibility};
 }catch{return defaultLayout();}
}
const valueOf = (task: TaskRow, field: TaskCellField) =>
  field === 'title' ? task.title : field === 'due' ? task.dueOn ?? '' : taskStatusLabels[task.status];
const canWrite = (props: FieldAccess) =>
  !!props.writable && !props.blocked && !!props.onSave && !!props.getTaskFields;

function TaskGridInput({ edit, latest, close, advance, onError }: {
  edit: CellEdit;
  latest: { current: FieldAccess };
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
    const undiscard = memory?.onDiscarded(controller.discard);
    return () => {
      controller.dispose();
      unregister?.();
      unconfirm?.();
      undiscard?.();
      bridge.current = null;
    };
  }, [edit, latest, close, advance, onError]);
  useEffect(() => { bridge.current?.refreshAccess(); });
  const label = `编辑${columnLabels[edit.field]}`;
  if (edit.field === 'status') {
    return (
      <select ref={node => { input.current = node; }} className={styles.input} aria-label={label} defaultValue={restored?.value ?? edit.value}>
        {Object.values(taskStatusLabels).map(label => <option key={label}>{label}</option>)}
      </select>
    );
  }
  return <input ref={node => { input.current = node; }} className={styles.input} aria-label={label} type={edit.field === 'due' ? 'date' : 'text'} defaultValue={restored?.value ?? edit.value} />;
}

type TaskTitleFieldProps = FieldAccess & {
  task: TaskRow;
  className?: string;
  onOpen?: (task: TaskRow, trigger?: HTMLButtonElement) => boolean | void;
};

/** Card and list titles use the same native field editor and receipt boundary as the grid. */
export function TaskTitleField(props: TaskTitleFieldProps) {
  const latest = useRef(props);
  latest.current = props;
  const trigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const [edit, setEdit] = useState<CellEdit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => {
    setEdit(null);
    setError(null);
    returnFocus.current = true;
  }, []);
  const open = useCallback(() => {
    const current = latest.current;
    if (!canWrite(current)) return;
    const fields = current.getTaskFields?.(current.task);
    if (!fields) return;
    const retained = current.draftMemory?.read();
    const draft = retained?.task.id === current.task.id && retained.field === 'title' ? retained : {
      task: { id: current.task.id, revision: current.task.revision },
      fields: structuredClone(fields), field: 'title' as const, value: current.task.title,
    };
    const writeDraft = current.draftMemory?.claim(draft.task, 'title', () => window.confirm('放弃尚未保存的修改？'));
    if (current.draftMemory && !writeDraft) return;
    setError(null);
    setEdit({ ...draft, writeDraft: writeDraft ?? (() => {}) });
  }, []);
  const onError = useCallback((message: string) => setError(message), []);
  const advance = useCallback(() => {}, []);
  useEffect(() => {
    if (!edit && returnFocus.current) {
      returnFocus.current = false;
      trigger.current?.focus();
    }
  }, [edit]);
  useEffect(() => {
    const retained = props.draftMemory?.read();
    if (!edit && retained?.task.id === props.task.id && retained.field === 'title') open();
  }, [props.task.id, props.task.revision, props.draftMemory, props.writable, props.blocked, edit, open]);
  if (edit) return (
    <span className={styles.titleEditor}>
      <TaskGridInput edit={edit} latest={latest} close={close} advance={advance} onError={onError}/>
      {error && <span role="alert" className={styles.error}>{error}</span>}
    </span>
  );
  const editable = canWrite(props);
  return <Button ref={trigger} variant="ghost" className={props.className}
    aria-label={`${editable ? '编辑标题' : '查看待办'}：${props.task.title}`}
    aria-keyshortcuts={editable ? 'Enter F2' : undefined}
    title={editable ? '双击编辑标题' : undefined}
    onDoubleClick={editable ? open : undefined}
    onClick={event => {
      if (!editable) props.onOpen?.(props.task, event.currentTarget);
      else if (event.detail === 0) open();
    }}
    onKeyDown={event => {
      if (editable && event.key === 'F2') { event.preventDefault(); open(); }
    }}
  ><span>{props.task.title}</span>{props.task.referenceChanged && <span className={styles.referenceChanged} role="img" aria-label="关联待核对">!</span>}</Button>;
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
  if (column.id === 'complete') {
    const task = row.original;
    const allowed = () => !!latest.current.writable && !latest.current.blocked && !!latest.current.onSetTaskStatus;
    return <Button variant="ghost" className={styles.complete} data-cell-interactive
      aria-label={`${task.status === 'done' ? '重新打开' : '完成'}：${task.title}`}
      aria-pressed={task.status === 'done'} disabled={!allowed()}
      onClick={() => {
        if (allowed()) latest.current.onSetTaskStatus?.({ id: task.id, revision: task.revision }, task.status === 'done' ? 'open' : 'done');
      }}
    ><span aria-hidden="true">{task.status === 'done' ? '✓' : '○'}</span></Button>;
  }
  if (!editableFields.includes(column.id as TaskCellField)) {
    return <Button variant="ghost" className={styles.open} data-cell-interactive disabled={latest.current.blocked}
      aria-label={column.id === 'detail' ? `打开任务：${row.original.title}` : `${columnLabels[column.id]}：${String(getValue())}，打开任务：${row.original.title}`}
      onClick={event => latest.current.onOpen(row.original, event.currentTarget)}><span>{String(getValue())}</span></Button>;
  }
  if (edit?.task.id === row.id && edit.field === column.id) {
    return <TaskGridInput edit={edit} latest={latest} close={close} advance={advance} onError={onError} />;
  }
  const value = column.id === 'status' ? taskStatusLabels[row.original.status] : String(getValue());
  return <span className={styles.cell} onDoubleClick={() => open(row.id, column.id as TaskCellField)}>{value || '—'}</span>;
}

function TaskGridColumnHeader({ column }: HeaderContext<typeof dataGridFeatures, TaskRow, unknown>) {
  if (column.id === 'complete'||column.id === 'detail') return columnLabels[column.id];
  const direction = column.getIsSorted();
  return <Button variant="ghost" className={styles.sort} data-sorted={direction || undefined}
    onClick={column.getToggleSortingHandler()} aria-label={`按${columnLabels[column.id]}排序`}>
    {columnLabels[column.id]}<span className={styles.sortIndicator} aria-hidden="true">{direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕'}</span>
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
  const [layoutState,setLayoutState]=useState<{scope:string|null;value:GridLayout}>({scope:null,value:defaultLayout()});
  const [rowEstimate,setRowEstimate]=useState(52);
  useEffect(()=>{if(typeof window.matchMedia!=='function')return;const media=window.matchMedia('(min-width:1024px) and (pointer:fine)');const update=()=>setRowEstimate(media.matches?40:52);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  const [columnsOpen,setColumnsOpen]=useState(false),[layoutNotice,setLayoutNotice]=useState('');
  const scope=props.viewPreferenceScope??null;
  const layout=layoutState.scope===scope?layoutState.value:defaultLayout();
  const visibility=useMemo<Record<string,boolean>>(()=>({project:props.tasks.some(task=>!!task.project),area:props.tasks.some(task=>!!task.area),...layout.visibility}),[props.tasks,layout.visibility]);
  useEffect(()=>{setLayoutState({scope,value:readLayout(scope)});setColumnsOpen(false);setLayoutNotice('');},[scope]);
  function changeLayout(value:GridLayout){
   setLayoutState({scope,value});
   if(scope){try{window.localStorage.setItem('lifeos.task-columns.v1:'+scope,JSON.stringify(value));setLayoutNotice('');}catch{setLayoutNotice('浏览器未允许保存，列设置仅用于本次视图。');}}
  }
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
    const visibleIds=tableRef.current?.getVisibleLeafColumns().map(column=>column.id)??columnIds;
    const position = index * visibleIds.length + visibleIds.indexOf(previous.field) + (direction === 'next' ? 1 : -1);
    if (position < 0 || position >= rows.length * visibleIds.length) return;
    const row = rows[Math.floor(position / visibleIds.length)];
    focusApi.current?.focusCell(row.id, visibleIds[position % visibleIds.length]);
  }, []);
  const onError = useCallback((message: string) => setError(message), []);
  const columns = useMemo<ColumnDef<typeof dataGridFeatures, TaskRow>[]>(() =>
    columnIds.map(id => ({
      id,
      size: columnWidths[id],
      minSize: columnMinWidths[id],
      accessorFn: task => id === 'status' ? task.status : id === 'title'||id === 'due' ? valueOf(task,id) : id === 'project' ? task.project?.title ?? '—' : id === 'area' ? task.area?.title ?? '—' : id === 'complete' ? task.status === 'done' : '查看详情',
      header: TaskGridColumnHeader,
      enableSorting: id!=='complete'&&id!=='detail',
      meta: {
        headerTitle: columnLabels[id],
        cellClassName: styles.tableCell,
        ...(id === 'title' ? { autoSize: true } : {}),
        ...(editableFields.includes(id as TaskCellField) ? { cellEdit: { editable: () => canWrite(latest.current) } } : {}),
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
    state: { pagination: { pageIndex: 0, pageSize: Math.max(data.length, 1) },columnOrder:layout.order,columnVisibility:visibility },
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
      <div className={styles.columnToolbar}><Button variant="ghost" disabled={props.blocked||!!edit} aria-expanded={columnsOpen} onClick={()=>setColumnsOpen(value=>!value)}>列设置</Button>
       {columnsOpen&&<div className={styles.columnSettings} role="group" aria-label="表格列设置"><p>列设置仅用于当前浏览器；无关联的项目/领域默认收起，可勾选显示。</p>{layout.order.map((id,index)=><div className={styles.columnSetting} key={id}>
        <label><input type="checkbox" aria-label={`显示${columnLabels[id]}列`} checked={visibility[id]!==false} disabled={props.blocked||!!edit||id==='complete'||id==='title'} onChange={event=>changeLayout({...layout,visibility:{...layout.visibility,[id]:event.target.checked}})}/>{columnLabels[id]}</label>
        <Button variant="ghost" disabled={props.blocked||!!edit||index===0} aria-label={`向前移动${columnLabels[id]}列`} onClick={()=>{const order=[...layout.order];[order[index-1],order[index]]=[order[index],order[index-1]];changeLayout({...layout,order});}}>↑</Button>
        <Button variant="ghost" disabled={props.blocked||!!edit||index===layout.order.length-1} aria-label={`向后移动${columnLabels[id]}列`} onClick={()=>{const order=[...layout.order];[order[index+1],order[index]]=[order[index],order[index+1]];changeLayout({...layout,order});}}>↓</Button>
       </div>)}<Button variant="outline" onClick={()=>changeLayout(defaultLayout())}>恢复默认列</Button>{layoutNotice&&<p role="status">{layoutNotice}</p>}</div>}
      </div>
      <DataGridContainer>
        <DataGrid table={table} recordCount={props.tasks.length}
          onCellEditRequest={request => {
            if (editableFields.includes(request.columnId as TaskCellField)) open(request.rowId, request.columnId as TaskCellField, request.initialText);
          }}
          i18n={{ labels: { empty: '没有符合条件的待办', loading: '正在加载表格…', allRowsLoaded: '已显示全部待办' } }}
          tableLayout={{ headerSticky: true, width: 'fixed', columnsResizable: true, columnsResizeMode: 'onEnd', cellSelection: true, cellSelectionMode: 'single', cellEditMode: 'dblclick', cellFillHandle: false }}
          tableClassNames={{ base: styles.table, headerRow: styles.header, bodyRow: styles.row }}>
          <DataGridTableVirtual height="100%" estimateSize={rowEstimate} overscan={10} scrollToRowIndex={restoreIndex >= 0 ? restoreIndex : undefined} />
          <DataGridCellSelection apiRef={focusApi} clipboard={false} />
        </DataGrid>
      </DataGridContainer>
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
    </GridCellContext.Provider>
  );
}
