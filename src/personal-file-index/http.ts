import {PlatformError, validateId} from '../platform/domain.ts';
import type {PersonalService} from '../personal-candidate/service.ts';
import {fileIndexPath, manifestSchema, samePin, type FileIndexRow, type ProjectPin} from './contract.ts';

const privacy = {'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff'};
const unavailable = () => new PlatformError(503, 'FILE_INDEX_UNAVAILABLE', '文件索引暂时无法核对。');

export async function handleFileIndexRequest(request: Request, options: {
  service: PersonalService;
  storageVerified: boolean;
  manifest?: string;
  assertOwner: () => Promise<void>;
}): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== fileIndexPath && !url.pathname.startsWith(fileIndexPath + '/')) return null;
  const {service, manifest, storageVerified, assertOwner} = options;
  const {ownerId, spaceId, allowedTypes, baseURL} = service.config;
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (request.headers.has('authorization') || origin !== null && origin !== new URL(baseURL).origin ||
    site === 'same-site' || site === 'cross-site' || !allowedTypes.includes('project')) {
    throw new PlatformError(403, 'FILE_INDEX_DENIED', '当前会话无权查看文件索引。');
  }
  if (request.method !== 'GET') return Response.json({error: {code: 'METHOD_NOT_ALLOWED'}}, {
    status: 405, headers: {...privacy, Allow: 'GET'},
  });
  if (url.search) throw new PlatformError(400, 'INVALID_QUERY', '文件索引不接受查询参数。');
  const open = /^\/api\/platform\/personal\/files\/([^/]+)\/project$/.exec(url.pathname);
  const missing = () => new PlatformError(404, 'NOT_FOUND', '文件索引项不存在或不可访问。');
  if (!open && url.pathname !== fileIndexPath) throw missing();
  if (manifest === undefined) {
    if (open) throw missing();
    return Response.json({state: 'unconnected'}, {headers: privacy});
  }
  if (!storageVerified || Buffer.byteLength(manifest) > 65536) throw unavailable();
  let raw: unknown;
  try { raw = JSON.parse(manifest); } catch { throw unavailable(); }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) throw unavailable();
  if (parsed.data.ownerId !== ownerId || parsed.data.spaceId !== spaceId) {
    throw new PlatformError(403, 'FILE_INDEX_DENIED', '当前空间无权查看文件索引。');
  }

  async function resolve(pin: ProjectPin | null): Promise<FileIndexRow['project']> {
    if (!pin) return {state: 'unlinked'};
    try {
      const entry = await service.get(ownerId, 'project', pin.id);
      if (entry.source.id !== pin.sourceId) return {state: 'unavailable'};
      if (!samePin(pin, {id: entry.id, sourceId: entry.source.id, revision: entry.revision})) return {state: 'changed'};
      if (!('title' in entry.draft)) throw unavailable();
      return {state: 'current', pin, title: entry.draft.title};
    } catch (error) {
      if (error instanceof PlatformError && error.status === 404) return {state: 'unavailable'};
      throw unavailable();
    }
  }
  if (open) {
    const id = validateId(open[1]);
    const row = parsed.data.entries.find(entry => entry.id === id);
    if (!row || row.location.state === 'example') throw missing();
    const project = await resolve(row.project);
    await assertOwner();
    if (project.state !== 'current') throw new PlatformError(409, 'FILE_PROJECT_CHANGED', '项目关联暂不可打开，请重新核对。');
    return Response.json({
      file: {id: row.id, sourceId: row.sourceId, revision: row.revision},
      project: project.pin,
    }, {headers: privacy});
  }

  const rows: FileIndexRow[] = [];
  const known = new Map<string, FileIndexRow['project']>();
  for (const {project, ...row} of parsed.data.entries) {
    if (row.location.state === 'example') {
      rows.push({...row, project: {state: 'unlinked'}});
      continue;
    }
    const key = JSON.stringify(project);
    const state = known.get(key) ?? await resolve(project);
    known.set(key, state);
    rows.push({...row, project: state});
  }
  await assertOwner();
  return Response.json({state: 'ready', rows}, {headers: privacy});
}
