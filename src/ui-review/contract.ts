import type {PersonalPlanningFields} from '../personal-candidate/planning';
import type{TaskCellDraftMemory}from"../personal-candidate/task-cell-draft";
import type {PersonalEditorFields} from "../personal-candidate/editor";
import type {PublicEntry} from "../platform/contracts";
import type { ReactNode } from "react";
import type {PersonalType} from "../personal-candidate/config";

export type TaskStatus = "open" | "in_progress" | "done" | "cancelled";
export type ReferenceLabel = { id: string; title: string };
export type TaskRow = PersonalPlanningFields & {
  id: string;
  revision: number;
  title: string;
  notes: string | null;
  status: TaskStatus;
  dueOn: string | null;
  area: ReferenceLabel | null;
  project: ReferenceLabel | null;
  /** Must come from an explicit source classification; missing relations are not an inbox. */
  inInbox: boolean | null;
  sourceLabel: string | null;
  /** Original validated Apple read time; never the website snapshot time. */
  sourceCapturedAt?: string | null;
  referenceChanged?: boolean;
};
export type AreaRow = ReferenceLabel & { revision: number };
export type ProjectRow = ReferenceLabel & PersonalPlanningFields & {
  revision: number;
  area: ReferenceLabel | null;
  stage: string | null;
  nextStep: string | null;
  referenceChanged?: boolean;
};
export type WorkspaceData = {
  tasks: readonly TaskRow[];
  areas: readonly AreaRow[];
  projects: readonly ProjectRow[];
  topics?: readonly (ReferenceLabel & {revision: number})[];
  today: string;
  asOf: string;
  /** complete only after the existing API's identity/scope/truncation checks succeed. */
  coverage: "complete" | "partial";
};
export type WorkspaceState =
  | { status: "unknown" | "loading"; message?: string }
  | { status: "error" | "forbidden"; message: string }
  | { status: "ready"; data: WorkspaceData };
export type WorkspaceAccess = {
  authenticated: boolean | null;
  writable: boolean | null;
  loginAllowed: boolean | null;
  /** Verified status capabilities; missing means no category creation links. */
  allowedTypes?: readonly PersonalType[];
  displayName?: string | null;
  message?: string | null;
};
export type WorkspacePage =
  | "overview"
  | "tasks"
  | "inbox"
  | "areas"
  | "projects"
  | "settings"
  | "requirements";
export type SettingsPanel = "general" | "topics" | "security" | "api-keys";
export type WorkspaceLocation = {page: Exclude<WorkspacePage,"settings">} & ({modal?: undefined; panel?: never; planId?: never}|{modal:"settings"; panel?: SettingsPanel; planId?: never}|{modal:"classification"; planId:string; panel?: never});
export type TaskView = "list" | "table" | "board" | "gantt";
export type TaskFilter = {
  query: string;
  status: "all" | "pending" | TaskStatus;
  areaId: string | null;
  projectId: string | null;
  inboxOnly: boolean;
  due?: "all" | "today" | "overdue";
};
export type LifeOSWorkspaceProps = {
  /** Verified owner+space scope for browser-only layout preferences; absent disables persistence. */
  viewPreferenceScope?: string | null;
  state: WorkspaceState;
  access: WorkspaceAccess;
  initialPage?: WorkspacePage;
  initialView?: TaskView;
  initialModal?: "settings" | "classification";
  initialClassificationPlanId?: string;
  classificationCloseGuard?: {current: (() => boolean) | null};
  renderClassification?: (planId: string, close: () => void, changePlan: (id: string) => void, container: HTMLElement | null) => ReactNode;
  initialSettingsPanel?: SettingsPanel;
  onBeforeSettingsChange?: () => boolean;
  settingsCloseGuard?: {current: (() => boolean) | null};
  renderSettingsPanel?: (panel: SettingsPanel) => ReactNode;
  availableSettingsPanels?: readonly SettingsPanel[];
  onRefresh?: () => void;
  onLogin?: () => void;
  onLogout?: () => void;
  onCreateTask?: () => boolean | void;
  /** Keep the existing revision/idempotency/recovery writer in the host. No optimistic local mutation. */
  onSetTaskStatus?: (
    task: Pick<TaskRow, "id" | "revision">,
    nextStatus: TaskStatus,
  ) => void;
  onOpenTask?: (task: Pick<TaskRow, "id" | "revision">, trigger?: HTMLElement) => boolean | void;
  /** The host owns all modal, cell-draft and in-flight navigation guards. */
  onBeforeNavigate?: () => boolean;
  onSaveTask?: (task: Pick<TaskRow,"id"|"revision">|null, fields: PersonalEditorFields) => Promise<PublicEntry|null>;
  getTaskFields?: (task: Pick<TaskRow,"id"|"revision">) => PersonalEditorFields|null;
  taskCellDraftMemory?: TaskCellDraftMemory;
  saving?: boolean;
  uncertain?: boolean;
  undoDeadline?: number|null;
  onUndoTaskStatus?: () => void;
  pendingTaskIds?: readonly string[];
  mutationError?: string | null;
  settingsContent?: ReactNode;
  contentPage?: {title: string; content: ReactNode;wide?:boolean};
  onNavigatePage?: (page: WorkspacePage) => void;
  syncUrl?: boolean;
  unavailablePage?: {title: string; message: string};
  /** QA-only banner, never a replacement for real data in the default route. */
  testLabel?: string;
};

/** Shared ordinary-grid boundary; the existing controller remains the only business writer. */
export type TaskGridProps = {
  viewPreferenceScope?: string | null;
  draftMemory?: TaskCellDraftMemory;
  tasks: readonly TaskRow[];
  onOpen: (task: TaskRow, trigger?: HTMLButtonElement) => void;
  writable?: boolean;
  blocked?: boolean;
  onSave?: (task: Pick<TaskRow, 'id' | 'revision'>, fields: PersonalEditorFields) => Promise<PublicEntry | null>;
  onSetTaskStatus?: LifeOSWorkspaceProps['onSetTaskStatus'];
  getTaskFields?: (task: Pick<TaskRow, 'id' | 'revision'>) => PersonalEditorFields | null;
};
