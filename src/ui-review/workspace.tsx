"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutDashboard,
  CheckSquare2,
  Folder,
  Layers,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  Plus,
  Search,
  List,
  Table2,
  Columns3,
  ChevronRight,
  ArrowUpRight,
  RefreshCw,
  HelpCircle,
  X,
  Check,
  Clock,
  AlertTriangle,
  LogIn,
  LogOut,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import {
  filterTasks,
  metricTaskFilter,
  taskMetrics,
  mayWrite,
  visibleWorkspaceState,
} from "./selectors";
import { TaskTable, statusLabels } from "./task-table";
import { TaskTitleField } from "./task-grid";
import { OverviewChart } from "./overview-chart";
import type {
  LifeOSWorkspaceProps,
  TaskRow,
  TaskStatus,
  WorkspacePage,
  WorkspaceState,
  TaskFilter,
  TaskView,
} from "./contract";
import "./review.css";
import {ThemeSwitch} from "../workbench/theme-switch";
import {CategoryEntries} from "../personal-candidate/category-entries";
import taskEditorStyles from "../personal-candidate/task-editor.module.css";

import {readWorkspacePage,workspaceHref} from '../workbench/private-navigation';

const navItems = [
  { id: "overview", label: "总览", icon: LayoutDashboard },
  { id: "tasks", label: "待办", icon: CheckSquare2 },
] as const;
const viewItems = [
  { id: "list", label: "列表", icon: List },
  { id: "table", label: "表格", icon: Table2 },
  { id: "board", label: "看板", icon: Columns3 },
] as const;
type WorkspaceHistoryEntry = {scope: string; index: number};
const workspaceHistoryKey = '__lifeosWorkspace';
function workspaceHistoryEntry(state: unknown): WorkspaceHistoryEntry | null {
  const entry = state && typeof state === 'object' ? (state as Record<string, unknown>)[workspaceHistoryKey] : null;
  if (!entry || typeof entry !== 'object') return null;
  const {scope, index} = entry as WorkspaceHistoryEntry;
  return typeof scope === 'string' && scope.length > 0 && Number.isSafeInteger(index) ? {scope, index} : null;
}
function browserHistoryIndex(): number | null {
  const navigation = (window as Window & {navigation?: {currentEntry?: {index: number} | null}}).navigation;
  const index = navigation?.currentEntry?.index;
  return typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 ? index : null;
}
const emptyTasks: readonly TaskRow[] = [];
const defaultFilter: TaskFilter = {
  query: "",
  status: "pending",
  areaId: null,
  projectId: null,
  inboxOnly: false,
};
const pageTitles: Record<WorkspacePage, string> = {
  overview: "总览",
  tasks: "待办",
  inbox: "收件箱",
  areas: "领域",
  projects: "项目",
  settings: "设置",
};

function DataState({
  state,
  onRefresh,
}: {
  state: WorkspaceState;
  onRefresh?: () => void;
}) {
  if (state.status === "ready") return null;
  const error = state.status === "error" || state.status === "forbidden";
  return (
    <div className="lo-data-state" role={error ? "alert" : "status"}>
      {error ? <AlertTriangle size={22} /> : <Clock size={22} />}
      <h2>
        {state.status === "loading"
          ? "正在读取数据"
          : state.status === "unknown"
            ? "等待数据连接"
            : state.status === "forbidden"
              ? "无法访问当前空间"
              : "数据读取失败"}
      </h2>
      {state.message && <p>{state.message}</p>}
      {onRefresh && (
        <Button variant="outline" onClick={onRefresh}>
          <RefreshCw size={16} />
          重新读取
        </Button>
      )}
    </div>
  );
}

export function LifeOSWorkspace(props: LifeOSWorkspaceProps) {
  const { access, onRefresh, unavailablePage, contentPage } = props;
  const state = visibleWorkspaceState(props.state, access);
  const [page, setPage] = useState<WorkspacePage>(
    props.initialPage ?? "overview",
  );
  const title = contentPage?.title ?? unavailablePage?.title ?? pageTitles[page];
  const [view, setView] = useState<TaskView>(props.initialView ?? "table");
  const [collapsed, setCollapsed] = useState(false),
    [mobileOpen, setMobileOpen] = useState(false),
    [filtersOpen, setFiltersOpen] = useState(false);
  const [filter, setFilter] = useState<TaskFilter>(defaultFilter);
  const [detailId, setDetailId] = useState<string | null>(null),
    [helpOpen, setHelpOpen] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const returnFocus = useRef<HTMLButtonElement | null>(null),
    menuButton = useRef<HTMLButtonElement | null>(null),
    helpButton = useRef<HTMLButtonElement | null>(null),
    tableViewButton = useRef<HTMLButtonElement | null>(null);
  const currentHref = useRef("");
  const currentHistory = useRef<WorkspaceHistoryEntry | null>(null);
  const restoringHistory = useRef(false);
  const currentBrowserIndex = useRef<number | null>(null);
  const currentHistoryState = useRef<unknown>(null);
  const data = state.status === "ready" ? state.data : null,
    tasks = data?.tasks ?? emptyTasks;
  const metrics = useMemo(() => taskMetrics(state), [state]);
  const rows = useMemo(
    () => filterTasks(tasks, { ...filter, inboxOnly: page === "inbox" || filter.inboxOnly }, data?.today),
    [tasks, filter, page, data?.today],
  );
  const pendingIds = new Set(props.pendingTaskIds ?? []);
  const canWrite = mayWrite(access) && !props.saving && !props.uncertain;
  const [undoNow,setUndoNow]=useState(0);
  useEffect(()=>{if(!props.undoDeadline)return;setUndoNow(Date.now());const timer=window.setTimeout(()=>setUndoNow(Date.now()),Math.max(0,props.undoDeadline-Date.now()));return()=>window.clearTimeout(timer);},[props.undoDeadline]);
  const overviewTasks = page === "overview" && state.status === "ready"
    ? filterTasks(tasks, defaultFilter).slice(0, 6)
    : emptyTasks;
  const activeProjects = data?.projects.filter(project => project.stage === "active") ?? [];
  const detail = data?.tasks.find((task) => task.id === detailId) ?? null;
  const filterActive =
    !!filter.query ||
    !!filter.areaId ||
    !!filter.projectId ||
    filter.status !== "pending" || !!filter.inboxOnly || (!!filter.due && filter.due !== "all");
  useEffect(() => {
    if (!portalContainer) return;
    const update = () => {
      const footer = document.querySelector<HTMLElement>(".lifeos-filing-footer");
      if (footer) portalContainer.style.setProperty("--lo-filing-footer-space", `${footer.getBoundingClientRect().height}px`);
      else portalContainer.style.removeProperty("--lo-filing-footer-space");
    };
    update();
    const footer = document.querySelector<HTMLElement>(".lifeos-filing-footer");
    const observer = new ResizeObserver(update);
    if (footer) observer.observe(footer);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      portalContainer.style.removeProperty("--lo-filing-footer-space");
    };
  }, [portalContainer]);
  useEffect(() => {
    if (!props.syncUrl) return;
    if (!currentHistory.current) {
      const entry = workspaceHistoryEntry(window.history.state) ?? {scope: crypto.randomUUID(), index: 0};
      window.history.replaceState({...window.history.state, [workspaceHistoryKey]: entry}, '', window.location.href);
      currentHistory.current = entry;
      currentHistoryState.current = window.history.state;
      currentBrowserIndex.current = browserHistoryIndex();
      currentHref.current = window.location.pathname + window.location.search;
    }
    const onPopState = (event: PopStateEvent) => {
      if (restoringHistory.current) {
        restoringHistory.current = false;
        return;
      }
      const entry = workspaceHistoryEntry(event.state);
      const url = new URL(window.location.href);
      const isTaskLink = url.pathname === "/personal/edit" && url.searchParams.get("type") === "todo";
      if (url.pathname !== "/personal" && !isTaskLink) return;
      const task = isTaskLink ? tasks.find(row => row.id === url.searchParams.get("id")) : null;
      const wantsCreate = isTaskLink ? !url.searchParams.has("id") : url.searchParams.get("create") === "todo";
      let allowed;
      if (task && props.onOpenTask) allowed = props.onOpenTask(task);
      else if (wantsCreate && props.onCreateTask) allowed = props.onCreateTask();
      else allowed = props.onBeforeNavigate?.();
      if (allowed === false) {
        const active = currentHistory.current;
        const nativeIndex = browserHistoryIndex();
        const delta = nativeIndex !== null && currentBrowserIndex.current !== null
          ? currentBrowserIndex.current - nativeIndex
          : active && entry?.scope === active.scope ? active.index - entry.index : null;
        // Reverse the traversal instead of pushing a replacement, which would
        // discard Forward entries. Native indexes also cover pre-marker entries.
        if (delta !== null && delta !== 0) {
          restoringHistory.current = true;
          window.history.go(delta);
        } else {
          // Older browsers cannot locate an unmarked history entry. Retain the
          // current draft and URL without a reload, guessed direction or new entry.
          window.history.replaceState(currentHistoryState.current, '', currentHref.current);
          currentBrowserIndex.current = browserHistoryIndex();
        }
        return;
      }
      if (isTaskLink && !task && !wantsCreate) {
        window.location.replace(url.pathname + url.search);
        return;
      }
      setPage(isTaskLink ? "tasks" : readWorkspacePage(url.searchParams.get("page")));
      setFilter(defaultFilter);
      setMobileOpen(false);
      setFiltersOpen(false);
      setDetailId(null);
      currentHref.current = url.pathname + url.search;
      currentBrowserIndex.current = browserHistoryIndex();
      currentHistory.current = entry ?? {scope: crypto.randomUUID(), index: 0};
      if (!entry) window.history.replaceState({...window.history.state, [workspaceHistoryKey]: currentHistory.current}, '', currentHref.current);
      currentHistoryState.current = window.history.state;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [props.syncUrl, props.onBeforeNavigate, props.onOpenTask, props.onCreateTask, tasks]);
  function navigate(
    next: WorkspacePage,
    areaId: string | null = null,
    projectId: string | null = null,
  ) {
    if (restoringHistory.current || props.onBeforeNavigate?.() === false) return false;
    if (props.onNavigatePage) {
      props.onNavigatePage(next);
      return true;
    }
    if (unavailablePage || contentPage) {
      window.location.assign(workspaceHref(next));
      return true;
    }
    if (props.syncUrl) {
      const href = workspaceHref(next);
      if (window.location.pathname + window.location.search !== href) {
        const active = currentHistory.current;
        const entry = {scope: active?.scope ?? crypto.randomUUID(), index: (active?.index ?? 0) + 1};
        window.history.pushState({...window.history.state, [workspaceHistoryKey]: entry}, '', href);
        currentHistory.current = entry;
        currentHistoryState.current = window.history.state;
        currentBrowserIndex.current = browserHistoryIndex();
      }
      currentHref.current = href;
    }
    setPage(next);
    setFilter({ ...defaultFilter, areaId, projectId });
    setMobileOpen(false);
    setFiltersOpen(false);
    setDetailId(null);
    return true;
  }
  function openTask(task: TaskRow, button?: HTMLButtonElement) {
    if (props.onOpenTask) {
      return props.onOpenTask({ id: task.id, revision: task.revision }, button);
    }
    if (props.onBeforeNavigate?.() === false) return false;
    returnFocus.current = button ?? tableViewButton.current;
    setDetailId(task.id);
    return true;
  }
  function toggleTask(task: TaskRow) {
    if (!canWrite || !props.onSetTaskStatus || pendingIds.has(task.id)) return;
    props.onSetTaskStatus(
      { id: task.id, revision: task.revision },
      task.status === "done" ? "open" : "done",
    );
  }
  const navigation = (
    <>
      <nav className="lo-nav" aria-label="主导航">
        {navItems.map(({ id, label, icon: Icon }) => (
          <Button
            variant="ghost"
            key={id}
            className={!unavailablePage && !contentPage && page === id ? "is-current" : ""}
            title={collapsed ? label : undefined}
            aria-label={label}
            aria-current={!unavailablePage && !contentPage && page === id ? "page" : undefined}
            data-workspace-nav
            onClick={() => navigate(id)}
          >
            <Icon size={19} />
            <span>{label}</span>
          </Button>
        ))}
      </nav>
      <div className="lo-sidebar-bottom">
        <Button
          variant="ghost"
          aria-label="设置"
          title={collapsed ? "设置" : undefined}
          className={page === "settings" ? "is-current" : ""}
          aria-current={page === "settings" ? "page" : undefined}
          data-workspace-nav
          onClick={() => navigate("settings")}
        >
          <Settings size={19} />
          <span>设置</span>
        </Button>
        <Button
          variant="ghost"
          className="lo-collapse"
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <PanelLeftOpen size={19} />
          ) : (
            <PanelLeftClose size={19} />
          )}
          <span>收起侧栏</span>
        </Button>
      </div>
    </>
  );
  function taskCard(task: TaskRow, board = false, overview = false) {
    return (
      <article
        className={board ? "lo-board-card" : overview ? "lo-task-row lo-overview-task" : "lo-task-row"}
        key={task.id}
      >
        <Button
          variant="ghost"
          className="lo-task-check"
          aria-label={`${task.status === "done" ? "重新打开" : "完成"}：${task.title}`}
          aria-busy={pendingIds.has(task.id)}
          disabled={
            !canWrite ||
            !props.onSetTaskStatus ||
            pendingIds.has(task.id)
          }
          onClick={() => toggleTask(task)}
        >
          {task.status === "done" ? (
            <Check size={18} />
          ) : (
            <span className="lo-unchecked" />
          )}
        </Button>
        <TaskTitleField
          task={task}
          writable={canWrite}
          blocked={!!props.saving || !!props.uncertain || pendingIds.has(task.id)}
          onSave={props.onSaveTask}
          getTaskFields={props.getTaskFields}
          draftMemory={props.taskCellDraftMemory}
          className="lo-task-title"
          onOpen={openTask}
        />
        <span className="lo-task-date">{task.dueOn ?? "—"}</span>
        {!board && (
          <span className="lo-task-project">{task.project?.title ?? "—"}</span>
        )}
        <Badge variant="outline" className="lo-task-status">
          {statusLabels[task.status]}
        </Badge>
        <div className="lo-task-actions">
          <Button variant="ghost" className="lo-icon-button" aria-label={`展开详情：${task.title}`} title="展开详情" onClick={event => openTask(task,event.currentTarget)}><ArrowUpRight size={17}/></Button>
        </div>
      </article>
    );
  }
  function taskContent() {
    if (state.status !== "ready")
      return <DataState state={state} onRefresh={onRefresh} />;
    if (view === "table")
      return (
        <TaskTable
          tasks={rows}
          writable={canWrite}
          blocked={!!props.saving || !!props.uncertain}
          onSave={props.onSaveTask}
          getTaskFields={props.getTaskFields}
          draftMemory={props.taskCellDraftMemory}
          onSetTaskStatus={props.onSetTaskStatus}
          onOpen={(task, trigger) => openTask(task, trigger)}
        />
      );
    if (!rows.length)
      return (
        <div className="lo-empty">
          <CheckSquare2 size={26} />
          <h2>
            {filterActive
              ? "没有符合条件的待办"
              : page === "inbox" && tasks.some((task) => task.inInbox === null)
                ? "收件箱分类尚未提供"
                : data?.coverage === "partial"
                  ? "当前已加载范围暂无待办"
                  : "暂无待办"}
          </h2>
          {filterActive && (
            <Button variant="outline" onClick={() => setFilter(defaultFilter)}>
              清除筛选
            </Button>
          )}
        </div>
      );
    if (view === "list")
      return (
        <div className="lo-task-list">
          <div className="lo-list-columns">
            <span>待办</span>
            <span>到期日</span>
            <span>项目</span>
            <span>状态</span>
          </div>
          {rows.map((task) => taskCard(task))}
        </div>
      );
    const columns: {
      status: "pending" | "in_progress" | "done" | "cancelled";
      title: string;
    }[] = [
      { status: "pending", title: "未完成" },
      { status: "in_progress", title: "进行中" },
      { status: "done", title: "已完成" },
      { status: "cancelled", title: "已取消" },
    ];
    return (
      <div className="lo-board">
        {columns.map((column) => {
          const items = rows.filter((task) =>
            column.status === "pending"
              ? task.status === "open"
              : task.status === column.status,
          );
          return (
            <section className="lo-board-column" key={column.status}>
              <h2>
                {column.title}
                <span>{items.length}</span>
              </h2>
              {items.map((task) => taskCard(task, true))}
              {!items.length && <div className="lo-board-empty">暂无待办</div>}
            </section>
          );
        })}
      </div>
    );
  }
  return (
    <div
      data-lifeos-surface="personal"
      className={`lo-shell ${collapsed ? "lo-is-collapsed" : ""}`}
      onMouseDownCapture={event => {
        const target = event.target as Element;
        if (target.closest?.("[data-workspace-nav], a[href]") && document.activeElement?.matches("input, textarea, select")) event.preventDefault();
      }}
      onClickCapture={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        const href = (event.target as Element).closest?.('a[href]')?.getAttribute("href");
        if (href && !href.startsWith("#") && (props.saving || props.uncertain || props.onBeforeNavigate?.() === false)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      ref={setPortalContainer}
    >
      <a className="lo-skip" href="#personal-main">跳到主要内容</a>
      <header className="lo-header">
        <Button
          variant="ghost"
          className="lo-mobile-menu"
          aria-label="打开导航"
          ref={menuButton}
          onClick={() => setMobileOpen(true)}
        >
          <Menu size={20} />
        </Button>
        <Button
          variant="ghost"
          className="lo-brand"
          aria-label="LifeOS 总览"
          data-workspace-nav
          onClick={() => navigate("overview")}
        >
          LifeOS
        </Button>
        <span className="lo-header-divider" />
        <span className="lo-header-context">{title}</span>
        <div className="lo-header-actions">
          <ThemeSwitch/>
          {access.authenticated === true && access.writable === false && (
            <Badge variant="outline">只读</Badge>
          )}
          <Button
            variant="ghost"
            className="lo-icon-button lo-header-help"
            aria-label="帮助"
            ref={helpButton}
            title="帮助"
            onClick={() => setHelpOpen(true)}
          >
            <HelpCircle size={19} />
          </Button>
        </div>
      </header>
      <div className="lo-body">
        <aside className="lo-sidebar">{navigation}</aside>
        <main id="personal-main" className="lo-main">
          <div className={contentPage ? "lo-content lo-content-account" : page === "settings" ? "lo-content lo-content-settings" :
            (page === "tasks" || page === "inbox") && view === "table" ? "lo-content lo-content-wide" : "lo-content"}>
          <div className="lo-page-heading">
            <div className="lo-heading-title">
              <h1>{title}</h1>
              {access.authenticated===true&&access.writable===false&&<Badge variant="outline" className="lo-mobile-read-only">只读</Badge>}
              {state.status === "ready" && page !== "settings" && (
                <span className="lo-result-count">
                  {page === "tasks" || page === "inbox"
                    ? page === "inbox" && metrics.inbox === null
                      ? "范围待确认"
                      : `${rows.length} 项${data?.coverage === "partial" ? "已加载" : ""}`
                    : ""}
                </span>
              )}
            </div>
            <div className="lo-page-actions">
              {page !== "settings" && !unavailablePage && !contentPage && onRefresh && (
                <Button
                  variant="ghost"
                  className="lo-icon-button"
                  aria-label="刷新数据"
                  onClick={onRefresh}
                >
                  <RefreshCw size={17} />
                </Button>
              )}
              {page !== "settings" && !unavailablePage && !contentPage && (
                <span
                  title={
                    !canWrite
                      ? (access.message ?? "尚未获得写入权限")
                      : !props.onCreateTask
                        ? "创建入口尚未接入"
                        : undefined
                  }
                >
                  <Button
                    className="lo-primary"
                    disabled={!canWrite || !props.onCreateTask}
                    onClick={() => {
                      if (canWrite) props.onCreateTask?.();
                    }}
                  >
                    <Plus size={17} />
                    新建待办
                  </Button>
                </span>
              )}
            </div>
          </div>
          {contentPage ? contentPage.content : unavailablePage ? (
            <p className="lo-unavailable" role="status">{unavailablePage.message}</p>
          ) : <>
          {props.testLabel && (
            <div className="lo-test-label">{props.testLabel}</div>
          )}
          {props.undoDeadline && props.undoDeadline > undoNow && props.onUndoTaskStatus && <div role="status" className={`lo-undo-notice ${taskEditorStyles.undo}`}>状态已更新 <Button variant="ghost" disabled={!canWrite} onClick={props.onUndoTaskStatus}>撤销</Button></div>}
          {props.mutationError && (
            <div className="lo-inline-error" role="alert">
              <AlertTriangle size={17} />
              {props.mutationError}
            </div>
          )}
          {page !== "settings" && state.status === "ready" && data?.coverage === "partial" && (
            <div className="lo-inline-error" role="status">
              仅显示已读取内容，完整统计暂不可用。
            </div>
          )}
          {page === "overview" && (
            <>
              <section className="lo-metrics" aria-label="任务指标">
                {([
                  {label:"待办",value:metrics.pending,metric:"pending"},
                  {label:"今日到期",value:metrics.dueToday,metric:"today"},
                  {label:"已逾期",value:metrics.overdue,metric:"overdue"},
                  {label:"推进中项目",value:data?.coverage === "complete" ? activeProjects.length : null,metric:"projects"},
                ] as const).map(({label,value,metric}) => (
                  <button key={label} className="lo-metric" data-workspace-nav aria-label={`${label}：${value === null ? "未知" : value}`} disabled={value === null} onClick={() => {if(navigate(metric === "projects" ? "projects" : "tasks") && metric !== "projects")setFilter(metricTaskFilter(metric));}}>
                    <span>{label}</span><strong>{value === null ? "—" : value}</strong>
                  </button>
                ))}
              </section>
              <div className="lo-overview-grid">
                <section className="lo-panel" hidden={state.status !== "ready"}>
                  <div className="lo-panel-heading">
                    <h2>待办</h2>
                    <Button variant="ghost" aria-label="查看全部待办" data-workspace-nav onClick={() => navigate("tasks")}>
                      <span>查看全部{metrics.pending === null ? "" : ` ${metrics.pending} 项`}</span><ArrowUpRight size={18} />
                    </Button>
                  </div>
                  <div className="lo-overview-task-list">
                    {overviewTasks.map(task => taskCard(task, false, true))}
                  </div>
                  {metrics.pending !== null && metrics.pending > overviewTasks.length && <p className="lo-overview-preview-note">显示前 {overviewTasks.length} 项待办</p>}
                  {metrics.pending === 0 && <div className="lo-empty-compact">暂无待办</div>}
                </section>
                {state.status !== "ready" ? <DataState state={state} onRefresh={onRefresh}/> : (
                    <section className="lo-panel">
                      <div className="lo-panel-heading">
                        <h2>任务状态</h2>
                        <span>
                          {metrics.total === null
                            ? "完整范围未知"
                            : `${metrics.total} 项`}
                        </span>
                      </div>
                      {metrics.total !== null &&
                      metrics.pending !== null &&
                      metrics.done !== null ? (
                        <>
                          <OverviewChart
                            pending={metrics.pending}
                            done={metrics.done}
                            cancelled={
                              metrics.total - metrics.pending - metrics.done
                            }
                          />
                          <div className="lo-chart-summary">
                            <span>
                              未完成 <strong>{metrics.pending}</strong>
                            </span>
                            <span>
                              已完成 <strong>{metrics.done}</strong>
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className="lo-empty-compact">完整统计暂不可用</div>
                      )}
                    </section>
                )}
              </div>
              {state.status === "ready" && (
                  <section className="lo-panel lo-project-overview">
                    <div className="lo-panel-heading">
                      <h2>推进中项目</h2>
                      <Button
                        variant="ghost"
                        aria-label="查看全部项目"
                        data-workspace-nav
                        onClick={() => navigate("projects")}
                      >
                        <ArrowUpRight size={18} />
                      </Button>
                    </div>
                    {activeProjects.length ? (
                      activeProjects.slice(0, 5).map((project) => (
                        <Button
                          variant="ghost"
                          key={project.id}
                          className="lo-project-line"
                          data-workspace-nav
                          onClick={() => navigate("tasks", null, project.id)}
                        >
                          <Folder size={18} />
                          <span>{project.title}</span>
                          <span className="lo-project-next">
                            {project.nextStep ?? "—"}
                          </span>
                          <ChevronRight size={16} />
                        </Button>
                      ))
                    ) : (
                      <div className="lo-empty-compact">暂无推进中的项目</div>
                    )}
                  </section>
              )}
            </>
          )}
          {(page === "tasks" || page === "inbox") && (
            <>
              {page === "tasks" && (
                <details className="lo-task-categories">
                  <summary>管理项目与领域</summary>
                  <div className="lo-category-entries">
                    <Button variant="outline" data-workspace-nav onClick={() => navigate("areas")}>管理领域</Button>
                    <Button variant="outline" data-workspace-nav onClick={() => navigate("projects")}>管理项目</Button>
                    <CategoryEntries allowedTypes={access.allowedTypes} writable={canWrite && pendingIds.size === 0 && !props.mutationError} className="lo-category-entries"/>
                  </div>
                </details>
              )}
              <div className="lo-task-toolbar">
                <label className="lo-search">
                  <Search size={17} />
                  <Input
                    aria-label="搜索待办"
                    placeholder="搜索待办"
                    value={filter.query}
                    onChange={(event) =>
                      setFilter({ ...filter, query: event.target.value })
                    }
                  />
                </label>
                <div
                  className="lo-view-switch"
                  role="group"
                  aria-label="待办视图"
                >
                  {viewItems.map(({ id, label, icon: Icon }) => (
                    <Button
                      variant="ghost"
                      aria-pressed={view === id}
                      className={view === id ? "is-active" : ""}
                      key={id}
                      data-workspace-nav
                      ref={id === "table" ? tableViewButton : undefined}
                      onClick={() => {
                        if (view !== id && props.onBeforeNavigate?.() === false) return;
                        setView(id);
                      }}
                    >
                      <Icon size={17} />
                      <span>{label}</span>
                    </Button>
                  ))}
                </div>
                <Button
                  variant="outline"
                  className="lo-filter-button"
                  aria-expanded={filtersOpen}
                  aria-controls="lo-filters"
                  onClick={() => setFiltersOpen(!filtersOpen)}
                >
                  <SlidersHorizontal size={16} />
                  筛选{filterActive && <span className="lo-filter-dot" />}
                </Button>
              </div>
              <div
                id="lo-filters"
                className="lo-filter-panel"
                hidden={!filtersOpen}
              >
                <label>
                  状态
                  <select
                    value={filter.status}
                    onChange={(event) =>
                      setFilter({
                        ...filter,
                        status: event.target.value as TaskFilter["status"],
                      })
                    }
                  >
                    <option value="pending">未完成及进行中</option>
                    <option value="all">全部状态</option>
                    <option value="open">未完成</option>
                    <option value="in_progress">进行中</option>
                    <option value="done">已完成</option>
                    <option value="cancelled">已取消</option>
                  </select>
                </label>
                <label>到期<select aria-label="到期筛选" value={filter.due ?? "all"} onChange={event=>setFilter({...filter,due:event.target.value as TaskFilter['due']})}><option value="all">全部日期</option><option value="today">今日到期</option><option value="overdue">已逾期</option></select></label>
                <label>收件箱<select aria-label="收件箱筛选" value={filter.inboxOnly?'inbox':'all'} onChange={event=>setFilter({...filter,inboxOnly:event.target.value==='inbox'})}><option value="all">全部待办</option><option value="inbox" disabled={metrics.inbox === null}>收件箱{metrics.inbox === null?'（未提供分类）':''}</option></select></label>
                <label>
                  领域
                  <select
                    value={filter.areaId ?? ""}
                    onChange={(event) =>
                      setFilter({
                        ...filter,
                        areaId: event.target.value || null,
                        projectId: null,
                      })
                    }
                  >
                    <option value="">全部领域</option>
                    {data?.areas.map((area) => (
                      <option key={area.id} value={area.id}>
                        {area.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  项目
                  <select
                    value={filter.projectId ?? ""}
                    onChange={(event) =>
                      setFilter({
                        ...filter,
                        projectId: event.target.value || null,
                      })
                    }
                  >
                    <option value="">全部项目</option>
                    {data?.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.title}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="ghost"
                  onClick={() => setFilter(defaultFilter)}
                >
                  清除
                </Button>
              </div>
              {(filter.areaId || filter.projectId) && (
                <div className="lo-active-filter">
                  {data?.areas.find((area) => area.id === filter.areaId)?.title}
                  {filter.projectId && (
                    <>
                      {" "}
                      /{" "}
                      {
                        data?.projects.find(
                          (project) => project.id === filter.projectId,
                        )?.title
                      }
                    </>
                  )}
                  <Button
                    variant="ghost"
                    aria-label="清除关联筛选"
                    onClick={() =>
                      setFilter({ ...filter, areaId: null, projectId: null })
                    }
                  >
                    <X size={15} />
                  </Button>
                </div>
              )}
              {((filter.due && filter.due !== 'all') || filter.inboxOnly) && <div className="lo-active-filter"><span>{filter.due === 'today'?'今日到期':filter.due === 'overdue'?'已逾期':''}{filter.inboxOnly?' 收件箱':''}</span><Button variant="ghost" aria-label="清除日期与收件箱筛选" onClick={()=>setFilter({...filter,due:'all',inboxOnly:false})}><X size={15}/></Button></div>}
              {taskContent()}
            </>
          )}
          {page === "areas" &&
            (state.status !== "ready" ? (
              <DataState state={state} onRefresh={onRefresh} />
            ) : (
              <div className="lo-entity-list">
                {data?.areas.map((area) => (
                  <Button
                    variant="ghost"
                    key={area.id}
                    onClick={() => navigate("tasks", area.id)}
                  >
                    <Layers size={18} />
                    <strong>{area.title}</strong>
                    <span>
                      {data.coverage === "complete"
                        ? `${tasks.filter((task) => task.area?.id === area.id && (task.status === "open" || task.status === "in_progress")).length} 项待办`
                        : "—"}
                    </span>
                    <ChevronRight size={17} />
                  </Button>
                ))}
                {!data?.areas.length && (
                  <div className="lo-empty-compact">暂无领域</div>
                )}
              </div>
            ))}
          {page === "projects" &&
            (state.status !== "ready" ? (
              <DataState state={state} onRefresh={onRefresh} />
            ) : (
              <div className="lo-project-table">
                <div className="lo-project-head">
                  <span>项目</span>
                  <span>领域</span>
                  <span>阶段</span>
                  <span>下一步</span>
                </div>
                {data?.projects.map((project) => (
                  <Button
                    variant="ghost"
                    key={project.id}
                    onClick={() => navigate("tasks", null, project.id)}
                  >
                    <strong>
                      {project.title}
                      {project.referenceChanged && (
                        <AlertTriangle size={15} aria-label="关联待核对" />
                      )}
                    </strong>
                    <span>{project.area?.title ?? "—"}</span>
                    <span>{project.stage ?? "—"}</span>
                    <span>{project.nextStep ?? "—"}</span>
                  </Button>
                ))}
                {!data?.projects.length && (
                  <div className="lo-empty-compact">暂无项目</div>
                )}
              </div>
            ))}
          {page === "settings" && (
            <div className="lo-settings">
              {access.authenticated === true && props.settingsContent}
              {access.authenticated === false &&
                access.loginAllowed === true &&
                props.onLogin && (
                  <Button variant="outline" onClick={props.onLogin}>
                    <LogIn size={17} />
                    前往登录
                  </Button>
                )}
              {access.authenticated === true && props.onLogout && (
                <Button variant="ghost" className="lo-logout" onClick={props.onLogout}>
                  <LogOut size={17} />
                  退出登录
                </Button>
              )}
            </div>
          )}
          </>}
          </div>
        </main>
      </div>
      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent
          container={portalContainer}
          className="lo-mobile-sidebar"
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            menuButton.current?.focus();
          }}
        >
          <DialogTitle>LifeOS</DialogTitle>
          <DialogDescription className="lo-screen-reader-table">
            主导航
          </DialogDescription>
          <Button
            variant="ghost"
            className="lo-sidebar-close"
            aria-label="关闭导航"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </Button>
          {navigation}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!detailId && !!detail}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
      >
        <DialogContent
          container={portalContainer}
          className="lo-detail"
          onCloseAutoFocus={(event) => {
            if (returnFocus.current) {
              event.preventDefault();
              returnFocus.current.focus();
            }
          }}
        >
          <DialogTitle>{detail?.title}</DialogTitle>
          <DialogDescription>
            {detail ? statusLabels[detail.status] : ""}
          </DialogDescription>
          <dl>
            {[
              ["领域", detail?.area?.title],
              ["项目", detail?.project?.title],
              ["到期日", detail?.dueOn],
              ["来源", detail?.sourceLabel],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value ?? "未提供"}</dd>
              </div>
            ))}
          </dl>
          {detail?.referenceChanged && (
            <p role="alert" className="lo-inline-error">
              关联来源已变化，需要重新核对。
            </p>
          )}
          <h3>备注</h3>
          <p className="lo-detail-notes">{detail?.notes || "暂无备注"}</p>
        </DialogContent>
      </Dialog>
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent
          container={portalContainer}
          className="lo-detail"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            helpButton.current?.focus();
          }}
        >
          <DialogTitle>帮助</DialogTitle>
          <DialogDescription>待办使用方式</DialogDescription>
          <ol className="lo-help-steps">
            <li>表格中双击标题、日期或状态，直接修改这个字段。</li>
            <li>点展开，查看并修改完整待办。</li>
            <li>点击列标题排序，拖动列边界调整宽度。</li>
          </ol>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Layout entry only. The host must provide its verified API state to LifeOSWorkspace. */
export function UIReview() {
  return (
    <LifeOSWorkspace
      state={{ status: "unknown" }}
      access={{ authenticated: null, writable: null, loginAllowed: null }}
    />
  );
}
