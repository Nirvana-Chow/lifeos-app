"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {Popover} from "radix-ui";
import {
  LayoutDashboard,
  Ellipsis,
  Plus,
  Search,
  List,
  Table2,
  Columns3,
  ChartNoAxesGantt,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  RefreshCw,
  X,
  Check,
  AlertTriangle,
  LogIn,
  LogOut,
  SlidersHorizontal,
  ShieldCheck,
  KeyRound,
  ClipboardList,
  Folders,
  Layers,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "./ui/dialog";
import {
  filterTasks,
  taskMetrics,
  mayWrite,
  visibleWorkspaceState,
} from "./selectors";
import { TaskTable, statusLabels } from "./task-table";
import {projectDetailHref} from '../personal-candidate/project-detail-href';
import {TaskProjectGantt} from './task-project-gantt';
import {TaskBoard} from "./task-board";
import { TaskTitleField } from "./task-grid";
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
import {ThemeSwitch,ThemeSystemAction} from "../workbench/theme-switch";
import {WorkspaceLayoutSettings, WorkspaceLayoutToggle} from "../workbench/workspace-layout-control";
import {CategoryGrid} from "./category-grid";
import {CollapseSidebarIcon,ExpandSidebarIcon,OpenNavigationIcon,SearchNavigationIcon,SettingsNavigationIcon,TodoNavigationIcon} from '../workbench/navigation-icons';
import {useOwnerModules,OwnerModuleLinks} from './owner-module-navigation';
import {OwnerReleaseNotice} from './owner-release-notice';
import {LogoutButton} from '../personal-candidate/privacy';
import {RequirementsPage} from "./requirements-page";
import {DailyOverview} from './daily-overview';
import taskEditorStyles from "../personal-candidate/task-editor.module.css";
import workspaceStyles from './workspace.module.css';
import {groupWorkspaceModules} from './workspace-hierarchy';

import {defaultSettingsPanel,readWorkspaceLocation,workspaceLocationHref,workspaceHref} from '../workbench/private-navigation';

const workspacePageNavigation = {
 overview:{label:'总览',icon:LayoutDashboard},
 tasks:{label:'待办',icon:TodoNavigationIcon},
 projects:{label:'个人项目',icon:Folders},
 areas:{label:'领域',icon:Layers},
} as const;
const viewItems = [
  { id: "list", label: "列表", icon: List },
  { id: "table", label: "表格", icon: Table2 },
  { id: "board", label: "看板", icon: Columns3 },
  { id: "gantt", label: "甘特", icon: ChartNoAxesGantt },
] as const;
type WorkspaceHistoryEntry = {scope: string; index: number};
const workspaceHistoryKey = '__lifeosWorkspace';
const moduleHistoryKey = '__lifeosWorkspaceModule';
function historyModule(state: unknown): string | null {
  const module = state && typeof state === 'object' ? (state as Record<string, unknown>)[moduleHistoryKey] : null;
  return typeof module === 'string' ? module : null;
}
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
  projects: "个人项目",
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
  if (state.status === "loading" || state.status === "unknown" && onRefresh && !state.message) {
    return (
      <div className="lo-data-placeholder" role="region" aria-label="数据区域" aria-busy="true">
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </div>
    );
  }
  if (state.status === "unknown") {
    return <p className="lo-data-state" role="status">{state.message || "当前数据连接不可用。"}</p>;
  }
  return (
    <div className="lo-data-state">
      <p role="alert">
        <strong>{state.status === "forbidden" ? "无法访问当前空间" : "数据读取失败"}</strong>
        {state.message && <span>{state.message}</span>}
      </p>
      {onRefresh && <Button variant="outline" onClick={onRefresh}>重新读取</Button>}
    </div>
  );
}

export function LifeOSWorkspace(props: LifeOSWorkspaceProps) {
  const { access, onRefresh, unavailablePage, contentPage } = props;
  const state = visibleWorkspaceState(props.state, access);
  const ownerModules=useOwnerModules(access.authenticated===true,props.viewPreferenceScope??null);
  const [page, setPage] = useState<WorkspacePage>(
    props.initialModal==='settings' ? 'settings' : props.initialPage ?? "overview",
  );
  const settingsOpen=page==='settings';
  const [classificationPlanId,setClassificationPlanId]=useState<string|null>(props.initialModal==='classification'?props.initialClassificationPlanId??null:null);
  const [settingsPanel,setSettingsPanel]=useState<SettingsPanel>(props.initialSettingsPanel??defaultSettingsPanel);
  const locationState=useRef({page,settingsOpen,settingsPanel,classificationPlanId});
  locationState.current={page,settingsOpen,settingsPanel,classificationPlanId};
  const title = contentPage?.title ?? unavailablePage?.title ?? pageTitles[page];
  const settingsSection=page==='settings'||page==='requirements'||ownerModules.path.startsWith('/personal/requirements/');
  const settingsSubpage=settingsOpen&&(settingsPanel==='security'||settingsPanel==='api-keys');
  const breadcrumbTitle=settingsSubpage?(settingsPanel==='security'?'安全与密码':'API 密钥'):title;
  const isOverview=page==='overview'&&!contentPage&&!unavailablePage;
  const [chosenModule,setChosenModule]=useState<string|null>(null);
  const globalSearch=props.desktopNavigation ? ownerModules.links.find(link=>link.id==='search') : undefined;
  const moduleGroups=groupWorkspaceModules(globalSearch ? ownerModules.links.filter(link=>link!==globalSearch) : ownerModules.links);
  const financeLink=props.desktopNavigation ? ownerModules.links.find(link=>link.id==='finance') : undefined;
  const portfolioLink=props.desktopNavigation ? ownerModules.links.find(link=>link.id==='portfolio') : undefined;
  const financeDestination=financeLink??portfolioLink;
  const developmentDestination=ownerModules.links.find(link=>link.id==='development-projects');
  const selectedModule=moduleGroups.find(group=>group.id===chosenModule);
  const settingsNavigationActive=settingsSection&&!selectedModule;
  const routeModule=moduleGroups.find(group=>group.links.some(link=>
    ownerModules.path===link.href||ownerModules.path.startsWith(link.href+'/'),
  ));
  const activeModule=settingsNavigationActive?undefined:selectedModule??routeModule??moduleGroups.find(group=>group.id==='daily');
  const moduleSwitch=(compact=false)=>(
    <nav aria-label="切换模块" className={compact?workspaceStyles.mobileModules:workspaceStyles.headerModules}>
      {moduleGroups.map(group=>group.id==='finance'&&financeDestination ? (
        <Button key={group.id} asChild variant="ghost">
          <a href={financeDestination.href} data-workspace-nav aria-current={routeModule?.id==='finance'?'page':undefined}>{group.label}</a>
        </Button>
      ) : group.id==='development-projects'&&developmentDestination ? (
        <Button key={group.id} asChild variant="ghost">
          <a href={developmentDestination.href} data-workspace-nav aria-current={routeModule?.id===group.id?'page':undefined}>{group.label}</a>
        </Button>
      ) : <Button key={group.id} variant="ghost" aria-pressed={group.id===activeModule?.id} data-workspace-nav
        onClick={()=>chooseModule(group.id)}>{group.label}</Button>)}
    </nav>
  );
  const toolLinks=ownerModules.links.filter(link=>link.id==='storage-review'||link.id==='file-handoffs');
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
  const verifiedPrivateScope = access.authenticated === true ? props.viewPreferenceScope : null;
  const [retainedPrivateScope, setRetainedPrivateScope] = useState<string | null>(null);
  if (access.authenticated === false && retainedPrivateScope !== null) setRetainedPrivateScope(null);
  if (verifiedPrivateScope && verifiedPrivateScope !== retainedPrivateScope) setRetainedPrivateScope(verifiedPrivateScope);
  const showPrivateRequirements = access.authenticated === true && (props.viewPreferenceScope === undefined || !!verifiedPrivateScope);
  const retainPrivateRequirements = access.authenticated !== false && (showPrivateRequirements || retainedPrivateScope !== null);
  const currentHref = useRef("");
  const currentHistory = useRef<WorkspaceHistoryEntry | null>(null);
  const restoringHistory = useRef(false);
  const currentBrowserIndex = useRef<number | null>(null);
  const currentHistoryState = useRef<unknown>(null);
  const historyLimit=useRef(0);
  const [historyControls,setHistoryControls]=useState({back:false,forward:false});
  function updateHistoryControls(){
    const navigation=(window as Window & {navigation?:{canGoBack?:boolean;canGoForward?:boolean}}).navigation;
    const index=currentHistory.current?.index??0;
    setHistoryControls({back:navigation?.canGoBack??(props.syncUrl?index>0:window.history.length>1),forward:navigation?.canGoForward??index<historyLimit.current});
  }
  function chooseModule(module: string | null) {
    setChosenModule(module);
    if (historyModule(window.history.state) === module) return;
    window.history.replaceState({...window.history.state, [moduleHistoryKey]:module}, '');
    if (props.syncUrl) currentHistoryState.current = window.history.state;
  }
  useEffect(()=>{
    const restoreModule = (event: PageTransitionEvent) => {
      setChosenModule(historyModule(window.history.state));
      if (event.persisted) setMobileOpen(false);
    };
    setChosenModule(historyModule(window.history.state));
    window.addEventListener('pageshow',restoreModule);
    return ()=>window.removeEventListener('pageshow',restoreModule);
  },[]);
  useEffect(()=>{
    if(props.syncUrl)return;
    const onPopState = (event: PopStateEvent) => {
      setChosenModule(historyModule(event.state));
      setMobileOpen(false);
      updateHistoryControls();
    };
    updateHistoryControls();
    window.addEventListener('popstate',onPopState);
    return()=>window.removeEventListener('popstate',onPopState);
  },[props.syncUrl]);
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
  const detail = data?.tasks.find((task) => task.id === detailId) ?? null;
  const filterActive =
    !!filter.query ||
    !!filter.areaId ||
    !!filter.projectId ||
    filter.status !== "pending" || !!filter.inboxOnly || (!!filter.due && filter.due !== "all");
  const filingSlot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!portalContainer) return;
    const slot = filingSlot.current;
    if (!slot) return;
    const body = document.body;
    let footer: HTMLElement | null = null;
    let nextSibling: ChildNode | null = null;
    const measure = () => {
      if (footer?.parentNode === slot) {
        portalContainer.style.setProperty("--lo-filing-footer-space", `${footer.getBoundingClientRect().height}px`);
      } else {
        portalContainer.style.removeProperty("--lo-filing-footer-space");
      }
    };
    const sizeObserver = new ResizeObserver(measure);
    const adoptFooter = () => {
      if (footer?.parentNode === slot) return;
      sizeObserver.disconnect();
      footer = body.querySelector<HTMLElement>(":scope > .lifeos-filing-footer");
      if (footer) {
        nextSibling = footer.nextSibling;
        slot.append(footer);
        sizeObserver.observe(footer);
      }
      measure();
    };
    // The deployment can append its existing footer before or after hydration.
    const bodyObserver = new MutationObserver(adoptFooter);
    bodyObserver.observe(body, {childList: true});
    adoptFooter();
    return () => {
      bodyObserver.disconnect();
      sizeObserver.disconnect();
      if (footer?.parentNode === slot) body.insertBefore(footer, nextSibling?.parentNode === body ? nextSibling : null);
      portalContainer.style.removeProperty("--lo-filing-footer-space");
    };
  }, [portalContainer]);
  useEffect(() => {
    if (!props.syncUrl) return;
    const initialLocation=readWorkspaceLocation(Object.fromEntries(new URLSearchParams(window.location.search)));
    if(initialLocation.page==='settings')window.history.replaceState(window.history.state,'',workspaceLocationHref(initialLocation));
    if (!currentHistory.current) {
      const entry = workspaceHistoryEntry(window.history.state) ?? {scope: crypto.randomUUID(), index: 0};
      window.history.replaceState({...window.history.state, [workspaceHistoryKey]: entry}, '', window.location.href);
      currentHistory.current = entry;
      historyLimit.current=Math.max(historyLimit.current,entry.index);
      updateHistoryControls();
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
      const isTaskLink = url.pathname === "/personal/edit" && url.searchParams.get("type") === "todo";
      if (url.pathname !== "/personal" && !isTaskLink) return;
      const nextLocation = readWorkspaceLocation(Object.fromEntries(url.searchParams));
      const historyPage=nextLocation.page;
      const sameBackground=!isTaskLink&&historyPage===locationState.current.page;
      const overlayChange=sameBackground&&(!!nextLocation.modal||!!locationState.current.classificationPlanId);
      const task = isTaskLink ? tasks.find(row => row.id === url.searchParams.get("id")) : null;
      const wantsCreate = isTaskLink ? !url.searchParams.has("id") : historyPage !== "requirements" && historyPage !== "settings" && url.searchParams.get("create") === "todo";
      let allowed;
      if (locationState.current.page==='requirements'&&!sameBackground&&requirementNavigationGuard.current?.()===false) allowed=false;
      else if (locationState.current.classificationPlanId && classificationCloseGuard?.current?.()===false) allowed=false;
      else if (locationState.current.settingsOpen&&settingsCloseGuard?.current?.()===false) allowed=false;
      else if (overlayChange || locationState.current.settingsOpen&&historyPage==='settings') allowed = saving||uncertain ? false : onBeforeSettingsChange?.();
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
      setChosenModule(historyModule(event.state));
      setClassificationPlanId(nextLocation.modal==='classification'?nextLocation.planId:null);
      setSettingsPanel(nextLocation.panel??defaultSettingsPanel);
      if(!overlayChange)setFilter(defaultFilter);
      setMobileOpen(false);
      if(!overlayChange){setFiltersOpen(false);setDetailId(null);}
      currentHref.current = url.pathname + url.search;
      currentBrowserIndex.current = browserHistoryIndex();
      currentHistory.current = entry ?? {scope: crypto.randomUUID(), index: 0};
      if (!entry) window.history.replaceState({...window.history.state, [workspaceHistoryKey]: currentHistory.current}, '', currentHref.current);
      currentHistoryState.current = window.history.state;
      historyLimit.current=Math.max(historyLimit.current,currentHistory.current.index);
      updateHistoryControls();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [props.syncUrl]);
  function settingsAllowed() {
    return !restoringHistory.current&&(!classificationPlanId||props.classificationCloseGuard?.current?.()!==false)&&!props.saving&&!props.uncertain&&props.onBeforeSettingsChange?.()!==false;
  }
  function openSettings() {
    if(!contentPage&&settingsOpen&&settingsPanel===defaultSettingsPanel&&selectedModule){chooseModule(null);return true;}
    return navigate('settings');
  }
  function traverseHistory(direction:'back'|'forward') {
    // Native workspace history has its own guarded popstate and restoration.
    // Content-only routes must check before Next can commit a SPA traversal.
    if(props.saving||props.uncertain)return;
    if(!props.syncUrl&&(classificationPlanId&&props.classificationCloseGuard?.current?.()===false||settingsOpen&&props.settingsCloseGuard?.current?.()===false||page==='requirements'&&requirementNavigationGuard.current?.()===false||props.onBeforeNavigate?.()===false))return;
    window.history[direction]();
  }
  function selectSettingsPanel(panel:SettingsPanel) {
    if(panel===settingsPanel)return true;
    if(!settingsAllowed()||props.settingsCloseGuard?.current?.()===false)return false;
    if(props.syncUrl){
      const active=currentHistory.current??{scope:crypto.randomUUID(),index:0},entry={scope:active.scope,index:active.index+1};
      const href=workspaceLocationHref({page:'settings',panel});
      window.history.pushState({[workspaceHistoryKey]:entry,[moduleHistoryKey]:historyModule(window.history.state)},'',href);
      currentHistory.current=entry;historyLimit.current=entry.index;currentHistoryState.current=window.history.state;currentHref.current=href;currentBrowserIndex.current=browserHistoryIndex();updateHistoryControls();
    }
    setSettingsPanel(panel);
    return true;
  }
  function navigate(
    next: WorkspacePage,
    areaId: string | null = null,
    projectId: string | null = null,
    nextSettingsPanel:SettingsPanel=defaultSettingsPanel,
  ) {
    if (restoringHistory.current || page==='requirements'&&next!==page&&requirementNavigationGuard.current?.()===false || classificationPlanId && props.classificationCloseGuard?.current?.()===false || settingsOpen && props.settingsCloseGuard?.current?.() === false || props.onBeforeNavigate?.() === false) return false;
    const destination=next==='settings'?workspaceLocationHref({page:'settings',panel:nextSettingsPanel}):workspaceHref(next);
    if((unavailablePage||contentPage)&&next==='settings'&&nextSettingsPanel!==defaultSettingsPanel){
      window.location.assign(destination);return true;
    }
    if (props.onNavigatePage) {
      props.onNavigatePage(next);
      return true;
    }
    if (unavailablePage || contentPage) {
      window.location.assign(destination);
      return true;
    }
    if (props.syncUrl) {
      const href = destination;
      if (window.location.pathname + window.location.search !== href) {
        const active = currentHistory.current;
        const entry = {scope: active?.scope ?? crypto.randomUUID(), index: (active?.index ?? 0) + 1};
        window.history.pushState({[workspaceHistoryKey]: entry, [moduleHistoryKey]:null}, '', href);
        currentHistory.current = entry;
        historyLimit.current=entry.index;
        updateHistoryControls();
        currentHistoryState.current = window.history.state;
        currentBrowserIndex.current = browserHistoryIndex();
      }
      currentHref.current = href;
    }
    if (chosenModule !== null) chooseModule(null);
    setClassificationPlanId(null);
    setPage(next);
    if(next==='settings')setSettingsPanel(nextSettingsPanel);
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
  const availableSettings = ([
    {id:'api-keys',label:'API 密钥',icon:KeyRound},
    {id:'security',label:'安全与密码',icon:ShieldCheck},
  ] as const).filter(item=>props.availableSettingsPanels?.includes(item.id));
  const settingsNavigation = (
    <nav className={`lo-nav ${workspaceStyles.settingsNavigation}`} aria-label="设置分类">
      <div role="group" aria-label="产品" className={workspaceStyles.navigationGroup}>
        <span className={workspaceStyles.navigationLabel}>产品</span>
        <Button variant="ghost" data-workspace-nav aria-label="需求池" title={collapsed?"需求池":undefined}
          className={page==='requirements'&&!contentPage?'is-current':undefined}
          aria-current={page==='requirements'&&!contentPage?'page':undefined} onClick={()=>navigate('requirements')}>
          <ClipboardList size={19} aria-hidden="true"/><span>需求池</span>
        </Button>
      </div>
      {toolLinks.length>0&&<div role="group" aria-label="资料与工具" className={workspaceStyles.navigationGroup}>
        <span className={workspaceStyles.navigationLabel}>资料与工具</span>
        <OwnerModuleLinks links={toolLinks} path={ownerModules.path} collapsed={collapsed}/>
      </div>}
      <div role="group" aria-label="偏好与账号" className={workspaceStyles.navigationGroup}>
        <span className={workspaceStyles.navigationLabel}>偏好与账号</span>
        {availableSettings.map(({id,label,icon:Icon})=>{
          const current=settingsOpen&&settingsPanel===id;
          return <Button variant="ghost" data-workspace-nav key={id} aria-label={label} title={collapsed?label:undefined}
            className={current?'is-current':undefined} aria-current={current?'page':undefined}
            onClick={()=>{if(!settingsOpen)navigate('settings',null,null,id);else if(selectSettingsPanel(id))setMobileOpen(false);}}>
            <Icon size={19} aria-hidden="true"/><span>{label}</span>
          </Button>;
        })}
      </div>
    </nav>
  );
  const navigation = (
    <>
      {settingsNavigationActive?settingsNavigation:<nav className="lo-nav" aria-label="主导航">
        {activeModule&&!(activeModule.id==='finance'&&financeDestination)&&<div role="group" aria-label={activeModule.label} className={workspaceStyles.navigationGroup}>
          <span className={workspaceStyles.navigationLabel}>{activeModule.label}</span>
          {activeModule.pages.map(id=>{
            const {label,icon:Icon}=workspacePageNavigation[id];
            const current=!unavailablePage&&!contentPage&&(page===id||id==='tasks'&&page==='inbox');
            return <Button variant="ghost" key={id} className={current?'is-current':undefined}
              title={collapsed?label:undefined} aria-label={label} aria-current={current?'page':undefined}
              data-workspace-nav onClick={()=>navigate(id)}>
              <Icon size={19} aria-hidden="true"/><span>{label}</span>
            </Button>;
          })}
          <OwnerModuleLinks links={activeModule.links} path={ownerModules.path} collapsed={collapsed}/>
        </div>}
      </nav>}
      <div className="lo-sidebar-bottom">
        <Button
          variant="ghost"
          aria-label="设置"
          title={collapsed ? "设置" : undefined}
          className={settingsNavigationActive ? "is-current" : ""}
          aria-current={settingsNavigationActive?"page":undefined}
          data-workspace-nav
          onClick={() => openSettings()}
        >
          <SettingsNavigationIcon/>
          <span>设置</span>
        </Button>
        <Button
          variant="ghost"
          className="lo-collapse"
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <ExpandSidebarIcon/>
          ) : (
            <CollapseSidebarIcon/>
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
          openDetailsOnClick
        />
        <span className="lo-task-date">{task.dueOn ?? "—"}</span>
        {!board && (
          task.project ? <a className="lo-task-project" href={projectDetailHref(task.project.id)}>{task.project.title}</a>
            : <span className="lo-task-project">—</span>
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
    if (view === "gantt") return <TaskProjectGantt label="待办" rows={rows} renderTitle={task=><button type="button" aria-label={`查看待办 ${task.title}`} onClick={event=>openTask(task,event.currentTarget)}>{task.title}</button>} partial={data?.coverage==='partial'} onShowTable={()=>{if(props.onBeforeNavigate?.()===false)return;setView('table');}}/>;
    const emptyMessage = filterActive ? "没有符合条件的待办"
      : page === "inbox" && tasks.some(task => task.inInbox === null) ? "收件箱分类尚未提供"
      : data?.coverage === "partial" ? "当前已加载范围暂无待办" : "暂无待办";
    if (view === "table")
      return (
        <TaskTable
          viewPreferenceScope={props.viewPreferenceScope}
          flatProjects
          tasks={rows}
          emptyMessage={emptyMessage}
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
        <div className="lo-empty lo-task-empty">
          <h2>{emptyMessage}</h2>
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
    return <TaskBoard flatProjects tasks={rows} writable={canWrite} blocked={settingsOpen||!!classificationPlanId||mobileOpen||!!props.saving||!!props.uncertain} pendingTaskIds={props.pendingTaskIds} scope={props.viewPreferenceScope} onSetTaskStatus={props.onSetTaskStatus} renderCard={task=>taskCard(task,true)}/>;
  }
  function keepFocusedWorkspaceField(event: Event) {
    const field=document.activeElement;
    if(field?.matches("input, textarea, select")&&!field.closest('[data-workspace-account-menu]'))event.preventDefault();
  }

  function canLogOut() {
    if (props.saving || props.uncertain) return false;
    if (page === 'requirements' && requirementNavigationGuard.current?.() === false) return false;
    if (classificationPlanId && props.classificationCloseGuard?.current?.() === false) return false;
    return !settingsOpen || props.settingsCloseGuard?.current?.() !== false;
  }

  const [signedOut,setSignedOut]=useState(false);
  if(signedOut)return <p role="status">已退出。</p>;
  const refreshAvailable=page!=="settings" && page!=="requirements" && !unavailablePage && !contentPage && onRefresh;
  const logoutIcon=<LogOut size={17} aria-hidden="true"/>;
  const logoutClass=props.desktopNavigation ? workspaceStyles.accountAction : "lo-icon-button lo-logout";
  const logoutAction=access.authenticated===true && (props.onLogout ? (
    <Button variant="ghost" className={logoutClass} aria-label="退出登录" data-workspace-nav
      onClick={()=>{if(canLogOut())props.onLogout?.();}}>
      {logoutIcon}{props.desktopNavigation && "退出登录"}
    </Button>
  ) : contentPage && (
    <LogoutButton className={logoutClass} icon={props.desktopNavigation ? <>{logoutIcon}退出登录</> : logoutIcon}
      beforeLogout={()=>canLogOut()&&props.onBeforeNavigate?.()!==false} onConfirmed={()=>setSignedOut(true)}/>
  ));

  return (
    <div
      data-lifeos-surface="personal"
      data-workspace-state={state.status}
      className={`lo-shell ${workspaceStyles.shell} ${props.desktopNavigation ? workspaceStyles.adaptiveLayout : ""} ${collapsed ? "lo-is-collapsed" : ""}`}
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
      {page!=='requirements'&&ownerModules.links.some(link=>link.id==='updates')&&ownerModules.scope&&props.viewPreferenceScope===ownerModules.scope&&!contentPage&&!unavailablePage&&<OwnerReleaseNotice scope={ownerModules.scope}/>}
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
          <OpenNavigationIcon/>
        </Button>
        <Button
          variant="ghost"
          className="lo-brand"
          aria-label="LifeOS 总览"
          data-workspace-nav
          onClick={() => navigate("overview")}
        >
          <svg aria-hidden="true" viewBox="-15 -13 226 226" width="21" height="21" fill="currentColor"><path d="M1 35C1 15.7 16.5 0 36 0S71 15.5 71 35v96c0 17 4 23 13 26 14 5 52-4 89-18 11-4 19-1 22 7 4 10-1 17-9 23-28 18-72 30-118 31C30 200 1 172 1 135Z"/></svg>
          LifeOS
        </Button>
        {moduleSwitch()}
        <div className="lo-header-actions">
          {props.desktopNavigation && <WorkspaceLayoutToggle className={`lo-icon-button ${workspaceStyles.layoutToggle}`}/>}
          <Button variant="ghost" size="icon" className="lo-icon-button" aria-label="打开设置" title="设置"
            data-workspace-nav onClick={()=>openSettings()}><SettingsNavigationIcon/></Button>
          {globalSearch && <Button asChild variant="ghost" size="icon" className="lo-icon-button">
            <a href={globalSearch.href} aria-label={globalSearch.label} title={globalSearch.label} data-workspace-nav>
              <SearchNavigationIcon/>
            </a>
          </Button>}
          <ThemeSwitch allowSystem={!props.desktopNavigation && settingsSection}/>
          {access.authenticated===true && access.writable===false && <Badge variant="outline">只读</Badge>}
          {props.desktopNavigation ? <Popover.Root>
            <Popover.Trigger asChild>
              <Button variant="ghost" size="icon" className="lo-icon-button" data-workspace-nav
                aria-label="账号与更多操作" title="账号与更多操作"><Ellipsis size={20} aria-hidden="true"/></Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="end" sideOffset={8} collisionPadding={8} aria-label="账号操作" className={workspaceStyles.accountMenu}
                data-workspace-account-menu onOpenAutoFocus={keepFocusedWorkspaceField} onCloseAutoFocus={keepFocusedWorkspaceField}>
                <WorkspaceLayoutSettings className={workspaceStyles.layoutSettings}/>
                <ThemeSystemAction className={workspaceStyles.accountAction}/>
                {refreshAvailable && <Button variant="ghost" className={workspaceStyles.accountAction} onClick={onRefresh}>
                  <RefreshCw size={17} aria-hidden="true"/>刷新数据
                </Button>}
                {logoutAction}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root> : logoutAction}
        </div>
      </header>
      <div className="lo-body">
        <aside className="lo-sidebar">{navigation}</aside>
        <main id="personal-main" tabIndex={settingsOpen?0:undefined} className={`lo-main ${!contentPage&&!unavailablePage&&["tasks","inbox","projects","areas","requirements"].includes(page)?"lo-main-bounded":""} ${!contentPage&&!unavailablePage&&["tasks","inbox","projects","areas"].includes(page)?"lo-main-matters":""}`}>
          <div data-matters-filters-expanded={filtersOpen&&(page==="tasks"||page==="inbox")?"":undefined} className={contentPage ? contentPage.wide?"lo-content lo-content-wide":"lo-content lo-content-account" : page === "settings" ? `lo-content lo-content-wide ${workspaceStyles.settingsContent}` :
            (page === "tasks" || page === "inbox") && view === "table" || page === "projects" || page === "areas" || page === "requirements" ? "lo-content lo-content-wide" : "lo-content"}>
          <nav aria-label="浏览位置" className={workspaceStyles.breadcrumbs}>
            <div className={workspaceStyles.breadcrumbTrail}>
              {!isOverview&&<><Button variant="ghost" aria-label="返回总览" data-workspace-nav onClick={()=>navigate('overview')}>总览</Button><ChevronRight aria-hidden="true" size={14}/></>}
              {settingsSubpage&&<><Button variant="ghost" aria-label="返回设置" data-workspace-nav onClick={()=>navigate('settings')}>设置</Button><ChevronRight aria-hidden="true" size={14}/></>}
              {isOverview
                ? <h1 className={workspaceStyles.breadcrumbCurrent} aria-current="page" tabIndex={-1}>{breadcrumbTitle}</h1>
                : <span className={workspaceStyles.breadcrumbCurrent} aria-current="page">{breadcrumbTitle}</span>}
              {isOverview&&access.authenticated===true&&access.writable===false&&<Badge variant="outline" className="lo-mobile-read-only">只读</Badge>}
            </div>
            <div className={workspaceStyles.historyButtons}>
              <Button variant="ghost" data-workspace-nav aria-label="后退" disabled={!historyControls.back} onClick={()=>traverseHistory('back')}><ArrowLeft size={16}/></Button>
              <Button variant="ghost" data-workspace-nav aria-label="前进" disabled={!historyControls.forward} onClick={()=>traverseHistory('forward')}><ArrowRight size={16}/></Button>
            </div>
          </nav>
          {!isOverview&&<div className="lo-page-heading">
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
              {contentPage&&financeLink&&portfolioLink&&ownerModules.path===financeLink.href&&<Button asChild variant="ghost">
                <a href={portfolioLink.href} data-workspace-nav>账户与投资</a>
              </Button>}
              {!props.desktopNavigation && refreshAvailable && (
                <Button
                  variant="ghost"
                  className="lo-icon-button"
                  aria-label="刷新数据"
                  onClick={onRefresh}
                >
                  <RefreshCw size={17} />
                </Button>
              )}
              {page === "tasks" && !unavailablePage && !contentPage &&
                state.status === "ready" && mayWrite(access) && access.allowedTypes?.includes("todo") && props.onCreateTask && (
                  <Button variant="outline" size="sm" className="lo-task-create" disabled={!canWrite} onClick={event => props.onCreateTask?.(event.currentTarget)}>
                    <Plus size={17} />
                    新建待办
                  </Button>
              )}
            </div>
          </div>}
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
              {([{id:"tasks",label:"待办"},{id:"projects",label:"项目"},{id:"areas",label:"领域"}] as const).filter(item=>item.id!=="areas"||page==="areas").map(item =>
                <Button key={item.id} variant="ghost" aria-label={item.label+"分类视图"} aria-pressed={page === item.id || item.id === "tasks" && page === "inbox"}
                  data-workspace-nav onClick={() => navigate(item.id)}>{item.label}</Button>)}
            </nav>}
          {page === "overview" && state.status !== "ready" && <DataState state={state} onRefresh={onRefresh}/>}
          {page === "overview" && <DailyOverview
            key={verifiedPrivateScope??'overview-unverified'} scope={verifiedPrivateScope??null}
            state={state} showTasks={showPrivateRequirements}
            scheduleHref={ownerModules.scope===verifiedPrivateScope ? ownerModules.links.find(link=>link.id==='calendar')?.href : undefined}
            journalHref={ownerModules.scope===verifiedPrivateScope ? ownerModules.links.find(link=>link.id==='journal')?.href : undefined}
            onRequirements={()=>navigate('requirements')} onTasks={()=>navigate('tasks')}
            renderTask={task=>taskCard(task,false,true)}
          />}
          {(page === "tasks" || page === "inbox") && (
            <>
              <div className="lo-task-toolbar">
                {page === "tasks" && (props.renderTaskClassificationPreview
                  ? access.authenticated !== false && <Dialog key={retainedPrivateScope}>
                    {verifiedPrivateScope && data?.coverage === "complete" &&
                      <DialogTrigger asChild><Button variant="outline">分类预览</Button></DialogTrigger>}
                    <DialogContent container={portalContainer} className="flex max-h-[85dvh] flex-col sm:max-w-4xl">
                      <DialogTitle>待办分类预览</DialogTitle>
                      <DialogDescription>核对原待办、项目和标签</DialogDescription>
                      <div className="min-h-0 overflow-y-auto">{props.renderTaskClassificationPreview()}</div>
                    </DialogContent>
                  </Dialog>
                  : verifiedPrivateScope && data?.coverage === "complete" &&
                    <Button asChild variant="outline"><a href="/personal/task-classification-preview">分类预览</a></Button>)}
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
              {page==='projects'&&projectView==='gantt'?<TaskProjectGantt label="项目" rows={data!.projects} renderTitle={project=><a href={projectDetailHref(project.id)}>{project.title}</a>} partial={data!.coverage==='partial'} onShowTable={()=>{if(props.onBeforeNavigate?.()===false)return;setProjectView('table');}}/>:<CategoryGrid key={page} kind={page} areas={data!.areas} projects={data!.projects} tasks={tasks}
                coverage={data!.coverage} writable={canWrite && access.allowedTypes?.includes(page === "projects" ? "project" : "domain") === true}
                onViewTasks={(areaId,projectId) => navigate("tasks",areaId,projectId)}/>}</>
            )}
          {settingsOpen&&<section data-settings-page className={workspaceStyles.settingsPage}>
            <div className={`lo-settings-panel ${workspaceStyles.settingsPanel}`} data-settings-panel={settingsPanel}>
              {settingsPanel===defaultSettingsPanel&&availableSettings.length>0&&<ul className={workspaceStyles.settingsIndex} aria-label="可用设置">
                {availableSettings.map(({id,label,icon:Icon})=><li key={id}>
                  <Button variant="ghost" data-workspace-nav onClick={()=>selectSettingsPanel(id)}>
                    <Icon size={19} aria-hidden="true"/><span>{label}</span><ChevronRight size={16} aria-hidden="true"/>
                  </Button>
                </li>)}
              </ul>}
              {access.authenticated === false && access.loginAllowed === true && props.onLogin && (
                <Button variant="outline" onClick={props.onLogin}>
                  <LogIn size={17} />
                  前往登录
                </Button>
              )}
              {settingsPanel==='topics'&&access.authenticated===true&&access.allowedTypes?.includes('topic')&&<section aria-label="标签">
                <h2>标签</h2>
                <p>同一标签可关联不同项目和待办，方便按主题归类。</p>
          {state.status !== "ready" ? <DataState state={state} onRefresh={onRefresh}/> : <>
            <label className="lo-topic-search">搜索标签<Input value={topicQuery} onChange={event=>setTopicQuery(event.target.value)} placeholder="按标签名称搜索"/></label>
            {data?.topics === undefined ? <p role="status">标签列表暂不可用，请重新读取。</p> : <>
              <ul className="lo-topic-list">{data.topics.filter(topic=>topic.title.toLocaleLowerCase().includes(topicQuery.trim().toLocaleLowerCase())).map(topic =>
                <li key={topic.id}><strong>{topic.title}</strong><span>版本 {topic.revision}</span>
                  {canWrite && <a href={"/personal/edit?type=topic&id="+encodeURIComponent(topic.id)}>编辑标签</a>}
                </li>)}</ul>
              {!data.topics.some(topic=>topic.title.toLocaleLowerCase().includes(topicQuery.trim().toLocaleLowerCase())) && <p>{topicQuery.trim()?"没有符合条件的标签。":"暂无标签。"}</p>}
            </>}
            {canWrite && <a className="lo-topic-create" href="/personal/edit?type=topic"><Plus size={16}/>新建标签</a>}
          </>}
              </section>}
              {(settingsPanel==='security'||settingsPanel==='api-keys')&&access.authenticated===true&&props.renderSettingsPanel?.(settingsPanel)}
            </div>
          </section>}
          {page === "requirements" && <>
            {retainPrivateRequirements && <RequirementsPage
              key={verifiedPrivateScope ?? retainedPrivateScope}
              scope={verifiedPrivateScope??undefined}
              concealed={!showPrivateRequirements}
              container={portalContainer?.querySelector<HTMLElement>('#personal-main')??null}
              navigationGuard={requirementNavigationGuard}
            />}
            {!showPrivateRequirements && <DataState state={state} onRefresh={onRefresh}/>}
          </>}
          </>}
          </div>
          <div className="lo-filing-slot" ref={filingSlot}/>
        </main>
      </div>
      {access.authenticated !== false && classificationPlanId && props.renderClassification?.(classificationPlanId, () => {
        if (props.classificationCloseGuard?.current?.()===false) return;
        const href=workspaceHref(page); window.history.replaceState(window.history.state,'',href); currentHref.current=href;currentHistoryState.current=window.history.state;setClassificationPlanId(null);
      }, id => {
        const href=workspaceLocationHref({page:page==='settings'?'overview':page,modal:'classification',planId:id});
        window.history.replaceState(window.history.state,'',href);currentHref.current=href;currentHistoryState.current=window.history.state;setClassificationPlanId(id);
      }, portalContainer)}
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
            {settingsSection?"设置分类":"主导航"}
          </DialogDescription>
          <Button
            variant="ghost"
            className="lo-sidebar-close"
            aria-label="关闭导航"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </Button>
          {!settingsSection&&moduleSwitch(true)}
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
