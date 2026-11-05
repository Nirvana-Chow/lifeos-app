"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  LayoutDashboard,
  CheckSquare2,
  Folder,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  Plus,
  Search,
  List,
  Table2,
  Columns3,
  ChartNoAxesGantt,
  ChevronRight,
  ArrowUpRight,
  RefreshCw,
  X,
  Check,
  Clock,
  AlertTriangle,
  LogIn,
  LogOut,
  SlidersHorizontal,
  ClipboardList,
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
import {TaskBoard} from "./task-board";
import { TaskTitleField } from "./task-grid";
import { OverviewChart } from "./overview-chart";
import type {
  LifeOSWorkspaceProps,
  TaskRow,
  TaskStatus,
  WorkspacePage,
  SettingsPanel,
  WorkspaceState,
  TaskFilter,
  TaskView,
} from "./contract";
import "./review.css";
import {ThemeSwitch,AppearanceSettings} from "../workbench/theme-switch";
import {CategoryGrid} from "./category-grid";
import {RequirementsPage} from "./requirements-page";
import taskEditorStyles from "../personal-candidate/task-editor.module.css";

import {readWorkspaceLocation,workspaceLocationHref,workspaceHref} from '../workbench/private-navigation';

const navItems = [
  { id: "overview", label: "总览", icon: LayoutDashboard },
  { id: "tasks", label: "事项", icon: CheckSquare2 },
  { id: "requirements", label: "需求池", icon: ClipboardList },
] as const;
const viewItems = [
  { id: "list", label: "列表", icon: List },
  { id: "table", label: "表格", icon: Table2 },
  { id: "board", label: "看板", icon: Columns3 },
  { id: "gantt", label: "甘特", icon: ChartNoAxesGantt },
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
  requirements: "需求池",
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
    props.initialPage === "settings" ? "overview" : props.initialPage ?? "overview",
  );
  const [settingsOpen,setSettingsOpen]=useState(props.initialModal==='settings'||props.initialPage==='settings');
  const [classificationPlanId,setClassificationPlanId]=useState<string|null>(props.initialModal==='classification'?props.initialClassificationPlanId??null:null);
  const [settingsPanel,setSettingsPanel]=useState<SettingsPanel>(props.initialSettingsPanel??'general');
  const settingsTrigger=useRef<HTMLButtonElement|null>(null);
  const settingsOpeners=useRef(new Map<number,{href:string;index:number;scope:string}>());
  const locationState=useRef({page,settingsOpen,settingsPanel,classificationPlanId});
  locationState.current={page,settingsOpen,settingsPanel,classificationPlanId};
  const title = contentPage?.title ?? unavailablePage?.title ?? pageTitles[page];
  const [projectView,setProjectView]=useState<"table"|"gantt">("table");
  const [view, setView] = useState<TaskView>(props.initialView ?? "table");
  const [collapsed, setCollapsed] = useState(false),
    [mobileOpen, setMobileOpen] = useState(false),
    [filtersOpen, setFiltersOpen] = useState(false);
  const [filter, setFilter] = useState<TaskFilter>(defaultFilter);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const returnFocus = useRef<HTMLButtonElement | null>(null),
    menuButton = useRef<HTMLButtonElement | null>(null),
    tableViewButton = useRef<HTMLButtonElement | null>(null);
  const requirementNavigationGuard=useRef<(()=>boolean)|null>(null);
  const currentHref = useRef("");
  const currentHistory = useRef<WorkspaceHistoryEntry | null>(null);
  const restoringHistory = useRef(false);
  const approvedSettingsClose=useRef<{href:string;scope:string;index:number}|null>(null);
  const currentBrowserIndex = useRef<number | null>(null);
  const currentHistoryState = useRef<unknown>(null);
  const data = state.status === "ready" ? state.data : null,
    tasks = data?.tasks ?? emptyTasks;
  // A router commit can occur inside popstate dispatch. Keep the native
  // subscription intact and expose only the latest committed handlers to it.
  const historyHandlers = useRef({tasks, onOpenTask: props.onOpenTask, onCreateTask: props.onCreateTask, onBeforeNavigate: props.onBeforeNavigate, onBeforeSettingsChange: props.onBeforeSettingsChange, settingsCloseGuard: props.settingsCloseGuard, classificationCloseGuard: props.classificationCloseGuard, saving: props.saving, uncertain: props.uncertain});
  useLayoutEffect(() => {
    historyHandlers.current = {tasks, onOpenTask: props.onOpenTask, onCreateTask: props.onCreateTask, onBeforeNavigate: props.onBeforeNavigate, onBeforeSettingsChange: props.onBeforeSettingsChange, settingsCloseGuard: props.settingsCloseGuard, classificationCloseGuard: props.classificationCloseGuard, saving: props.saving, uncertain: props.uncertain};
  });
  const metrics = useMemo(() => taskMetrics(state), [state]);
  const rows = useMemo(
    () => filterTasks(tasks, { ...filter, inboxOnly: page === "inbox" || filter.inboxOnly }, data?.today),
    [tasks, filter, page, data?.today],
  );
  const pendingIds = new Set(props.pendingTaskIds ?? []);
  const canWrite = mayWrite(access) && !props.saving && !props.uncertain;
  const [undoNow,setUndoNow]=useState(0);
  const [topicQuery,setTopicQuery]=useState("");
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
      const {tasks, onOpenTask, onCreateTask, onBeforeNavigate, onBeforeSettingsChange, settingsCloseGuard, classificationCloseGuard, saving, uncertain} = historyHandlers.current;
      const entry = workspaceHistoryEntry(event.state);
      const url = new URL(window.location.href);
      const approval=approvedSettingsClose.current;
      approvedSettingsClose.current=null;
      const closingApproved=!!approval&&approval.href===url.pathname+url.search&&approval.scope===entry?.scope&&approval.index===entry.index;
      const isTaskLink = url.pathname === "/personal/edit" && url.searchParams.get("type") === "todo";
      if (url.pathname !== "/personal" && !isTaskLink) return;
      const nextLocation = readWorkspaceLocation(Object.fromEntries(url.searchParams));
      const historyPage=nextLocation.page;
      const sameBackground=!isTaskLink&&historyPage===locationState.current.page;
      const overlayChange=sameBackground&&(!!nextLocation.modal||locationState.current.settingsOpen||!!locationState.current.classificationPlanId);
      const task = isTaskLink ? tasks.find(row => row.id === url.searchParams.get("id")) : null;
      const wantsCreate = isTaskLink ? !url.searchParams.has("id") : historyPage !== "requirements" && url.searchParams.get("create") === "todo";
      let allowed;
      if (locationState.current.page==='requirements'&&!sameBackground&&requirementNavigationGuard.current?.()===false) allowed=false;
      else if (locationState.current.classificationPlanId && classificationCloseGuard?.current?.()===false) allowed=false;
      else if (overlayChange) allowed = saving||uncertain ? false :
        locationState.current.settingsOpen&&!closingApproved&&settingsCloseGuard?.current?.()===false ? false : onBeforeSettingsChange?.();
      else if (locationState.current.settingsOpen&&settingsCloseGuard?.current?.()===false) allowed=false;
      else if (task && onOpenTask) allowed = onOpenTask(task);
      else if (wantsCreate && onCreateTask) allowed = onCreateTask();
      else allowed = onBeforeNavigate?.();
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
      setPage(isTaskLink ? "tasks" : historyPage);
      setSettingsOpen(nextLocation.modal==='settings');
      setClassificationPlanId(nextLocation.modal==='classification'?nextLocation.planId:null);
      setSettingsPanel(nextLocation.panel??'general');
      if(!overlayChange)setFilter(defaultFilter);
      setMobileOpen(false);
      if(!overlayChange){setFiltersOpen(false);setDetailId(null);}
      currentHref.current = url.pathname + url.search;
      currentBrowserIndex.current = browserHistoryIndex();
      currentHistory.current = entry ?? {scope: crypto.randomUUID(), index: 0};
      if (!entry) window.history.replaceState({...window.history.state, [workspaceHistoryKey]: currentHistory.current}, '', currentHref.current);
      currentHistoryState.current = window.history.state;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [props.syncUrl]);
  function settingsAllowed() {
    return !restoringHistory.current&&!approvedSettingsClose.current&&(!classificationPlanId||props.classificationCloseGuard?.current?.()!==false)&&!props.saving&&!props.uncertain&&props.onBeforeSettingsChange?.()!==false;
  }
  function openSettings(trigger?:HTMLButtonElement|null) {
    if(!settingsAllowed())return false;
    if(unavailablePage||contentPage){window.location.assign(workspaceHref('settings'));return true;}
    settingsTrigger.current=trigger??settingsTrigger.current;
    if(props.syncUrl&&!settingsOpen){
      const active=currentHistory.current??{scope:crypto.randomUUID(),index:0};
      const entry={scope:active.scope,index:active.index+1};
      const background=window.location.pathname+window.location.search;
      const href=workspaceLocationHref({page:page==='settings'?'overview':page,modal:'settings',panel:'general'});
      settingsOpeners.current.set(entry.index,{href:background,index:active.index,scope:active.scope});
      window.history.pushState({...window.history.state,[workspaceHistoryKey]:entry},'',href);
      currentHistory.current=entry;currentHistoryState.current=window.history.state;currentHref.current=href;currentBrowserIndex.current=browserHistoryIndex();
    }
    setClassificationPlanId(null);setSettingsPanel('general');setSettingsOpen(true);setMobileOpen(false);return true;
  }
  function selectSettingsPanel(panel:SettingsPanel) {
    if(panel===settingsPanel)return;
    if(!settingsAllowed()||props.settingsCloseGuard?.current?.()===false)return;
    if(props.syncUrl){
      const href=workspaceLocationHref({page:page==='settings'?'overview':page,modal:'settings',panel});
      window.history.replaceState(window.history.state,'',href);currentHref.current=href;
    }
    setSettingsPanel(panel);
  }
  function closeSettings() {
    if(!settingsAllowed()||props.settingsCloseGuard?.current?.()===false)return;
    if(props.syncUrl){
      const active=currentHistory.current,opener=active&&settingsOpeners.current.get(active.index);
      if(opener&&active&&opener.scope===active.scope&&opener.index===active.index-1&&opener.href===workspaceHref(page)){
        approvedSettingsClose.current={href:opener.href,scope:opener.scope,index:opener.index};
        window.history.back();return;
      }
      const href=workspaceHref(page);
      window.history.replaceState(window.history.state,'',href);currentHref.current=href;currentHistoryState.current=window.history.state;
    }
    setSettingsOpen(false);
  }
  function navigate(
    next: WorkspacePage,
    areaId: string | null = null,
    projectId: string | null = null,
  ) {
    if(next==="settings")return openSettings();
    if (restoringHistory.current || page==='requirements'&&next!==page&&requirementNavigationGuard.current?.()===false || classificationPlanId && props.classificationCloseGuard?.current?.()===false || settingsOpen && props.settingsCloseGuard?.current?.() === false || props.onBeforeNavigate?.() === false) return false;
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
    setClassificationPlanId(null);setSettingsOpen(false);
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
            className={!unavailablePage && !contentPage && (page === id || id === "tasks" && ["projects","areas","inbox"].includes(page)) ? "is-current" : ""}
            title={collapsed ? label : undefined}
            aria-label={label}
            aria-current={!unavailablePage && !contentPage && (page === id || id === "tasks" && ["projects","areas","inbox"].includes(page)) ? "page" : undefined}
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
          className={settingsOpen ? "is-current" : ""}
          aria-expanded={settingsOpen}
          data-workspace-nav
          onClick={event => openSettings(event.currentTarget)}
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
          blocked={settingsOpen || !!classificationPlanId || mobileOpen || !!props.saving || !!props.uncertain || pendingIds.has(task.id)}
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
    if (view === "gantt") return <UnscheduledGantt label="待办" count={rows.length} partial={data?.coverage==='partial'} onShowTable={()=>{if(props.onBeforeNavigate?.()===false)return;setView('table');}}/>;
    if (view === "table")
      return (
        <TaskTable
          viewPreferenceScope={props.viewPreferenceScope}
          tasks={rows}
          writable={canWrite}
          blocked={settingsOpen || !!classificationPlanId || mobileOpen || !!props.saving || !!props.uncertain}
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
          <div className="lo-list-rows">{rows.map((task) => taskCard(task))}</div>
        </div>
      );
    return <TaskBoard tasks={rows} writable={canWrite} blocked={settingsOpen||!!classificationPlanId||mobileOpen||!!props.saving||!!props.uncertain} pendingTaskIds={props.pendingTaskIds} scope={props.viewPreferenceScope} onSetTaskStatus={props.onSetTaskStatus} renderCard={task=>taskCard(task,true)}/>;
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
        const link = (event.target as Element).closest?.('a[href]');
        const href = link?.getAttribute("href");
        if (link?.hasAttribute?.('data-classification-reauth') || (!classificationPlanId && (link?.hasAttribute?.('download') || link?.getAttribute('target') === '_blank'))) return;
        if (href && (page==='requirements'&&requirementNavigationGuard.current?.()===false || props.saving || props.uncertain || classificationPlanId && props.classificationCloseGuard?.current?.()===false || settingsOpen && props.settingsCloseGuard?.current?.() === false || props.onBeforeNavigate?.() === false)) {
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
          data-workspace-nav
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

        </div>
      </header>
      <div className="lo-body">
        <aside className="lo-sidebar">{navigation}</aside>
        <main id="personal-main" className={`lo-main ${!contentPage&&!unavailablePage&&["tasks","inbox","projects","areas","requirements"].includes(page)?"lo-main-bounded":""} ${!contentPage&&!unavailablePage&&["tasks","inbox","projects","areas"].includes(page)?"lo-main-matters":""}`}>
          <div data-matters-filters-expanded={filtersOpen&&(page==="tasks"||page==="inbox")?"":undefined} className={contentPage ? "lo-content lo-content-account" : page === "settings" ? "lo-content lo-content-settings" :
            (page === "tasks" || page === "inbox") && view === "table" || page === "projects" || page === "areas" || page === "requirements" ? "lo-content lo-content-wide" : "lo-content"}>
          <div className="lo-page-heading">
            <div className="lo-heading-title">
              <h1 tabIndex={-1}>{title}</h1>
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
              {page !== "settings" && page !== "requirements" && !unavailablePage && !contentPage && onRefresh && (
                <Button
                  variant="ghost"
                  className="lo-icon-button"
                  aria-label="刷新数据"
                  onClick={onRefresh}
                >
                  <RefreshCw size={17} />
                </Button>
              )}
              {(page === "overview" || page === "tasks" || page === "inbox") && !unavailablePage && !contentPage && (
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
          {(page === "tasks" || page === "inbox" || page === "projects" || page === "areas") &&
            <nav className="lo-task-sections" aria-label="待办分类视图">
              {([{id:"tasks",label:"待办"},{id:"projects",label:"项目"},{id:"areas",label:"领域"}] as const).map(item =>
                <Button key={item.id} variant="ghost" aria-label={item.label+"分类视图"} aria-pressed={page === item.id || item.id === "tasks" && page === "inbox"}
                  data-workspace-nav onClick={() => navigate(item.id)}>{item.label}</Button>)}
            </nav>}
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
              <div className="lo-workspace-view">{taskContent()}</div>
            </>
          )}
          {(page === "projects" || page === "areas") &&
            (state.status !== "ready" ? <DataState state={state} onRefresh={onRefresh}/> :
              <>{page==='projects'&&<div className="lo-task-toolbar"><div className="lo-view-switch" role="group" aria-label="项目视图">{(['table','gantt'] as const).map(id=><Button key={id} variant="ghost" className={projectView===id?"is-active":""} aria-pressed={projectView===id} onClick={()=>{if(projectView!==id&&props.onBeforeNavigate?.()===false)return;setProjectView(id);}}>{id==='table'?<Table2 size={17}/>:<ChartNoAxesGantt size={17}/>}<span>{id==='table'?'表格':'甘特'}</span></Button>)}</div></div>}
              {page==='projects'&&projectView==='gantt'?<UnscheduledGantt label="项目" count={data!.projects.length} partial={data!.coverage==='partial'} onShowTable={()=>{if(props.onBeforeNavigate?.()===false)return;setProjectView('table');}}/>:<CategoryGrid key={page} kind={page} areas={data!.areas} projects={data!.projects} tasks={tasks}
                coverage={data!.coverage} writable={canWrite && access.allowedTypes?.includes(page === "projects" ? "project" : "domain") === true}
                onViewTasks={(areaId,projectId) => navigate("tasks",areaId,projectId)}/>}</>
            )}
          {page === "requirements" && <RequirementsPage container={portalContainer?.querySelector<HTMLElement>('#personal-main')??null} navigationGuard={requirementNavigationGuard}/>}
          </>}
          </div>
        </main>
      </div>
      {classificationPlanId && props.renderClassification?.(classificationPlanId, () => {
        if (props.classificationCloseGuard?.current?.()===false) return;
        const href=workspaceHref(page); window.history.replaceState(window.history.state,'',href); currentHref.current=href;currentHistoryState.current=window.history.state;setClassificationPlanId(null);
      }, id => {
        const href=workspaceLocationHref({page:page==='settings'?'overview':page,modal:'classification',planId:id});
        window.history.replaceState(window.history.state,'',href);currentHref.current=href;currentHistoryState.current=window.history.state;setClassificationPlanId(id);
      }, portalContainer)}
      <Dialog open={settingsOpen} onOpenChange={open=>{if(!open)closeSettings();}}>
        <DialogContent container={portalContainer} className="lo-settings-dialog" aria-labelledby="lo-settings-title" aria-describedby={undefined}
          onOpenAutoFocus={event=>{event.preventDefault();document.getElementById('lo-settings-title')?.focus();}}
          onCloseAutoFocus={event=>{event.preventDefault();if(settingsTrigger.current?.isConnected)settingsTrigger.current.focus();}}>
          <DialogTitle id="lo-settings-title" tabIndex={-1}>设置</DialogTitle>
          <div className="lo-settings-layout">
            <nav aria-label="设置分类" className="lo-settings-panels">
              {([{id:'general',label:'通用'},{id:'topics',label:'业务标签'},{id:'security',label:'安全与密码'},{id:'api-keys',label:'API 密钥'}] as const)
                .filter(item=>item.id==='general'||item.id==='topics'&&access.allowedTypes?.includes('topic')||props.availableSettingsPanels?.includes(item.id))
                .map(item=><Button variant="ghost" key={item.id} aria-pressed={settingsPanel===item.id} onClick={()=>selectSettingsPanel(item.id)}>{item.label}</Button>)}
            </nav>
            <div className="lo-settings-panel" data-settings-panel={settingsPanel}>
          {settingsPanel === "general" && (
            <div className="lo-settings">
              <AppearanceSettings/>
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
              {settingsPanel==='topics'&&access.authenticated===true&&access.allowedTypes?.includes('topic')&&<section aria-label="业务标签">
                <h2>业务标签</h2>
          {state.status !== "ready" ? <DataState state={state} onRefresh={onRefresh}/> : <>
            <label className="lo-topic-search">搜索业务标签<Input value={topicQuery} onChange={event=>setTopicQuery(event.target.value)} placeholder="按主题名称搜索"/></label>
            {data?.topics === undefined ? <p role="status">主题列表暂不可用，请重新读取。</p> : <>
              <ul className="lo-topic-list">{data.topics.filter(topic=>topic.title.toLocaleLowerCase().includes(topicQuery.trim().toLocaleLowerCase())).map(topic =>
                <li key={topic.id}><strong>{topic.title}</strong><span>版本 {topic.revision}</span>
                  {canWrite && <a href={"/personal/edit?type=topic&id="+encodeURIComponent(topic.id)}>编辑主题</a>}
                </li>)}</ul>
              {!data.topics.some(topic=>topic.title.toLocaleLowerCase().includes(topicQuery.trim().toLocaleLowerCase())) && <p>{topicQuery.trim()?"没有符合条件的主题。":"暂无主题。"}</p>}
            </>}
            {canWrite && <a className="lo-topic-create" href="/personal/edit?type=topic"><Plus size={16}/>新建业务标签</a>}
          </>}
              </section>}
              {(settingsPanel==='security'||settingsPanel==='api-keys')&&access.authenticated===true&&props.renderSettingsPanel?.(settingsPanel)}
            </div>
          </div>
        </DialogContent>
      </Dialog>
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

/** Current task/project records have no explicit start/end pair. Never infer one from dueOn or stage. */
function UnscheduledGantt({label,count,partial,onShowTable}:{label:string;count:number;partial:boolean;onShowTable:()=>void}){
 return <section className="lo-empty" aria-label={`${label}甘特`}><ChartNoAxesGantt size={28} aria-hidden="true"/><h2>尚无完整排期</h2><p>甘特仅显示有计划开始和结束日期的{label}，不会用到期日或阶段推算日期。</p><p>{partial?'当前已加载范围内':'当前'} {count} 项{label}未完整排期，可在表格中查看。</p><Button variant="outline" onClick={onShowTable}>查看{label}表格</Button></section>;
}
