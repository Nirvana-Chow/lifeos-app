import type {
  WorkspaceState,
  WorkspaceAccess,
  TaskFilter,
  TaskRow,
} from "./contract.ts";
const pending = (task: TaskRow) =>
  task.status === "open" || task.status === "in_progress";
export function taskMetrics(state: WorkspaceState): {
  total: number | null;
  pending: number | null;
  dueToday: number | null;
  overdue: number | null;
  done: number | null;
  inbox: number | null;
} {
  const unknown = {
    total: null,
    pending: null,
    dueToday: null,
    overdue: null,
    done: null,
    inbox: null,
  };
  if (state.status !== "ready" || state.data.coverage !== "complete")
    return unknown;
  const { tasks, today } = state.data;
  return {
    total: tasks.length,
    pending: tasks.filter(pending).length,
    dueToday: tasks.filter((t) => pending(t) && t.dueOn === today).length,
    overdue: tasks.filter(
      (t) => pending(t) && t.dueOn !== null && t.dueOn < today,
    ).length,
    done: tasks.filter((t) => t.status === "done").length,
    inbox: tasks.every((t) => t.inInbox !== null)
      ? tasks.filter((t) => t.inInbox).length
      : null,
  };
}
export function filterTasks(
  tasks: readonly TaskRow[],
  filter: TaskFilter,
  today?: string,
): TaskRow[] {
  const query = filter.query.trim().toLocaleLowerCase();
  return tasks.filter(
    (task) =>
      (!filter.inboxOnly || task.inInbox === true) &&
      (!filter.due || filter.due === "all" || !!today && (filter.due === "today" ? task.dueOn === today : task.dueOn !== null && task.dueOn < today)) &&
      (!filter.areaId || task.area?.id === filter.areaId) &&
      (!filter.projectId || task.project?.id === filter.projectId) &&
      (filter.status === "all" ||
        (filter.status === "pending" && pending(task)) ||
        task.status === filter.status) &&
      (!query ||
        [task.title, task.area?.title, task.project?.title]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(query)),
  );
}
export function mayWrite(access: WorkspaceAccess): boolean {
  return access.authenticated === true && access.writable === true;
}
export function visibleWorkspaceState(
  state: WorkspaceState,
  access: WorkspaceAccess,
): WorkspaceState {
  if (state.status !== "ready" || access.authenticated === true) return state;
  return access.authenticated === false
    ? { status: "forbidden", message: "请重新登录后读取。" }
    : { status: "loading" };
}

/** Cards and task destinations share the pending/date semantics used by taskMetrics. */
export function metricTaskFilter(metric: "pending" | "today" | "overdue"): TaskFilter {
 return {query:"",status:"pending",areaId:null,projectId:null,inboxOnly:false,due:metric === "pending" ? "all" : metric};
}
