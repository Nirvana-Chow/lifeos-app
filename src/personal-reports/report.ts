import {validateId,validateTodo} from '../platform/domain.ts';
import {workspaceData} from '../personal-candidate/workspace-data.ts';

export class ReportAccessError extends Error {}

export function projectReviewId(value: unknown): string {
  try { return validateId(value); } catch { return ''; }
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function projectReports(snapshot: unknown, spaceId: string, today: string) {
  const {data, entries} = workspaceData(snapshot, spaceId, today, 'task-workspace-current-snapshot');
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const tasksByProject = new Map<string, typeof data.tasks>();
  for (const task of data.tasks) {
    if (!task.project) continue;
    const members = tasksByProject.get(task.project.id) ?? [];
    members.push(task);
    tasksByProject.set(task.project.id, members);
  }
  const titleCounts = new Map<string,number>();
  for (const project of data.projects) titleCounts.set(project.title,(titleCounts.get(project.title) ?? 0)+1);
  const reports = data.projects.map(project => {
    const tasks = (tasksByProject.get(project.id) ?? []).map(task => ({
      id: task.id, title: task.title, status: task.status, revision: task.revision,
      sourceId: byId.get(task.id)!.source.id, referenceChanged: task.referenceChanged,
      linkedProjectRevision: validateTodo(byId.get(task.id)!.draft).personal?.project?.revision ?? null,
    }));
    const sourceId = byId.get(project.id)!.source.id;
    const stamp = JSON.stringify([
      sourceId, project.revision, tasks.map(task => [task.id, task.sourceId, task.revision]).sort(),
    ]);
    return {
      id: project.id, title: project.title, sourceId, revision: project.revision,
      duplicateTitle: (titleCounts.get(project.title) ?? 0)>1,
      tasks, stamp, referenceChanged: project.referenceChanged || tasks.some(task => task.referenceChanged),
    };
  });
  return {observedAt: data.asOf, reports, projectCount: data.projects.length, taskCount: data.tasks.length};
}

type ReviewProjection = ReturnType<typeof projectReports>;
type ProjectReviewEvidence = {historyCoverage:'complete'|'partial'; originalDecision:null};

export async function readProjectReports(today: string, signal: AbortSignal, fetcher: typeof fetch = fetch, requestedProject='') {
  async function read(path: string): Promise<unknown> {
    const response = await fetcher('/api/platform/personal/' + path, {credentials: 'same-origin', cache: 'no-store', signal});
    if (response.status === 401 || response.status === 403 || response.status === 404 && path.includes('/history?')) throw new ReportAccessError();
    if (!response.ok) throw new Error('Report snapshot unavailable');
    return response.json();
  }
  async function identity() {
    const value = await read('status');
    if (!object(value) || value.scope !== 'personal-manual-candidate' || value.storageVerified !== true ||
        typeof value.ownerId !== 'string' || !value.ownerId || typeof value.spaceId !== 'string' || !value.spaceId ||
        !Array.isArray(value.allowedTypes) || !value.allowedTypes.includes('project') || !value.allowedTypes.includes('todo')) {
      throw new ReportAccessError();
    }
    return {ownerId: value.ownerId, spaceId: value.spaceId};
  }
  const before = await identity();
  const snapshot = await read('todo/workspace-snapshot?' + new URLSearchParams({today,view:'project-reports'}));
  if (!object(snapshot) || snapshot.scope !== 'task-workspace-current-snapshot' || snapshot.today !== today ||
      snapshot.truncated !== false || !object(snapshot.review) || !Array.isArray(snapshot.review.reports) ||
      snapshot.review.projectCount !== snapshot.review.reports.length || typeof snapshot.review.observedAt !== 'string' ||
      !Number.isFinite(Date.parse(snapshot.review.observedAt))) throw new Error('Review projection unavailable');
  const review = snapshot.review as ReviewProjection;
  const selected = requestedProject ? review.reports.find(project=>project.id===requestedProject) : review.reports[0];
  let evidence: ProjectReviewEvidence|null = null;
  if (selected) {
    const version = await read('project/'+encodeURIComponent(selected.id)+'/history?view=review-evidence');
    if (!object(version) || version.scope!=='project-review-evidence' || version.projectId!==selected.id ||
        version.sourceId!==selected.sourceId || version.revision!==selected.revision ||
        (version.historyCoverage!=='complete' && version.historyCoverage!=='partial') ||
        version.originalDecision!==null) throw new Error('Project evidence changed');
    evidence={historyCoverage:version.historyCoverage,originalDecision:null};
  }
  const after = await identity();
  if (before.ownerId !== after.ownerId || before.spaceId !== after.spaceId) throw new ReportAccessError();
  signal.throwIfAborted();
  return {binding: JSON.stringify([before.ownerId, before.spaceId]), ...review,evidence};
}
