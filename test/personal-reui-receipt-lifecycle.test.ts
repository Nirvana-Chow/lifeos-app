import test from 'node:test';
import assert from 'node:assert/strict';
import { PersonalWorkspaceController } from '../src/personal-candidate/workspace-controller.ts';
import { TaskCellDraftMemory } from '../src/personal-candidate/task-cell-draft.ts';
import { editorFromEntry } from '../src/personal-candidate/editor.ts';
import { mountTaskGridEditor } from '../src/personal-candidate/task-grid-editor.ts';

const id = '11111111-1111-4111-8111-111111111111';
const sourceId = '22222222-2222-4222-8222-222222222222';
class Input extends EventTarget {
  value = ''; disabled = false; focuses = 0;
  focus() { this.focuses++; }
  fire(type: string, extra: Record<string, unknown> = {}) {
    const event = new Event(type, { cancelable: true }); Object.assign(event, extra); this.dispatchEvent(event);
  }
}
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise<void>(resolve => setImmediate(resolve)); };
function fixture() {
  let owner = 'fixture-owner', revision = 3, title = 'Original', lost = false, conflict = false;
  const commands: Array<{ key: string; body: any }> = [], saved = new Map<string, any>(), storage = new Map<string, string>();
  const entry = () => ({ id, kind: 'todo', draft: { title, notes: 'Notes', dueOn: null, status: 'open' }, source: { id: sourceId, system: 'website', externalId: id, version: 1, asOf: '2026-10-27T00:00:00Z', original: { marker: 'personal-manual-v1', spaceId: 'fixture-space', type: 'todo', input: {} } }, revision, syncState: 'draft', externalStatus: null });
  const fetcher: typeof fetch = async (url, init) => {
    const path = String(url);
    if (path.endsWith('/availability')) return Response.json({ configured: true, loginAllowed: true, https: true });
    if (path.endsWith('/status')) return Response.json({ scope: 'personal-manual-candidate', ownerId: owner, spaceId: 'fixture-space', storageVerified: true, writable: true, allowedTypes: ['todo'] });
    if (path.includes('/overview')) return Response.json({ items: [entry()], total: 1, scope: 'full-current-snapshot', truncated: false, today: '2026-11-02', observedAt: '2026-11-02T00:00:00Z' });
    assert.equal(path, '/api/platform/personal/todo/' + id); assert.equal(init?.method, 'PATCH');
    const key = new Headers(init?.headers).get('idempotency-key')!, body = JSON.parse(String(init?.body)); commands.push({ key, body });
    if (conflict) return Response.json({ error: { code: 'REVISION_CONFLICT' } }, { status: 409 });
    if (!saved.has(key)) { title = body.fields.title; revision = body.expectedRevision + 1; saved.set(key, { ...entry(), draft: body.fields }); }
    if (lost) { lost = false; throw Error('Synthetic lost receipt'); }
    return Response.json({ entry: saved.get(key), duplicate: commands.length > 1 });
  };
  const controller = new PersonalWorkspaceController({ fetcher, origin: 'https://fixture.invalid', storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); } }, today: () => '2026-11-02', key: () => 'reui-synthetic-command-001' });
  const memory = new TaskCellDraftMemory();
  return { controller, memory, commands, storage, loseReceipt() { lost = true; }, conflict() { conflict = true; }, remoteEdit() { revision++; title = 'Newer remote'; }, otherOwner() { owner = 'fixture-other-owner'; } };
}
function mount(f: ReturnType<typeof fixture>) {
  const { controller, memory } = f;
  const identity = { id, revision: 3 };
  const source = controller.getTaskEntry(identity);
  assert.ok(source, JSON.stringify(controller.getSnapshot()));
  const fields = editorFromEntry(source, 'fixture-space').fields;
  const input = new Input(); let closes = 0;
  const writer = memory.claim(identity, 'title', () => false)!;
  const editor = mountTaskGridEditor(input as unknown as HTMLInputElement, {
    task: identity, fields, field: 'title', value: fields.title,
    canSave: () => { const snapshot = controller.getSnapshot(); return !!snapshot.access.writable && !snapshot.saving && !snapshot.uncertain && snapshot.state.status === 'ready'; },
    save: async (task, next) => { const receipt = await controller.saveTask(task, next); if (receipt) memory.confirm(receipt); return receipt; },
    onDraft: writer, onClose: () => { closes++; }, onError: () => {},
  });
  const uncapture = memory.registerCapture(editor.captureDraft);
  const unconfirm = memory.onConfirmed(() => editor.confirm());
  return { input, editor, closes: () => closes, dispose() { editor.dispose(); uncapture(); unconfirm(); } };
}

test('ReUI DOM editor retains unknown text and retries the frozen real controller command before installing receipt', async () => {
  const f = fixture(); await f.controller.refresh(); f.memory.verify(f.controller.getEditorBinding());
  const h = mount(f); h.input.value = '中文确认'; h.input.fire('input'); f.loseReceipt(); h.input.fire('keydown', { key: 'Enter' });
  await settle(); assert.equal(f.controller.getSnapshot().uncertain, true);
  const state = f.controller.getSnapshot().state; assert.equal(state.status, 'ready'); if (state.status === 'ready') assert.equal(state.data.tasks[0].title, 'Original');
  assert.equal(h.closes(), 0); assert.equal(f.memory.read()?.value, '中文确认'); assert.equal(f.commands.length, 1);
  const receipt = await f.controller.retry(); assert.ok(receipt); f.memory.confirm(receipt);
  assert.equal(h.closes(), 1); assert.equal(f.memory.read(), null);
  assert.deepEqual(f.commands[1], f.commands[0]); assert.equal(f.commands[0].body.expectedRevision, 3);
  const next = f.controller.getSnapshot().state; assert.equal(next.status, 'ready'); if (next.status === 'ready') { assert.equal(next.data.tasks[0].title, '中文确认'); assert.equal(next.data.tasks[0].revision, 4); }
  h.dispose();
});

test('ReUI conflict retains original draft revision across refresh; a newer snapshot never rebases its write', async () => {
  const f = fixture(); await f.controller.refresh(); f.memory.verify(f.controller.getEditorBinding());
  const h = mount(f); h.input.value = 'Local draft'; h.input.fire('input'); f.conflict(); h.input.fire('keydown', { key: 'Enter' }); await settle();
  assert.equal(h.closes(), 0); assert.equal(f.memory.read()?.task.revision, 3); assert.equal(f.commands.length, 1);
  h.dispose(); f.remoteEdit(); await f.controller.refresh(); f.memory.verify(f.controller.getEditorBinding());
  const draft = f.memory.read()!; assert.equal(draft.value, 'Local draft'); assert.equal(draft.task.revision, 3);
  assert.equal(await f.controller.saveTask(draft.task, { ...draft.fields, title: draft.value }), null);
  assert.equal(f.commands.length, 1); assert.match(f.controller.getSnapshot().mutationError!, /版本/);
});

test('conceal captures ReUI draft and hides it until fresh same binding; changed owner clears it', async () => {
  const f = fixture(); await f.controller.refresh(); f.memory.verify(f.controller.getEditorBinding());
  const h = mount(f); h.input.value = 'Private unsent';
  f.memory.conceal(); f.controller.suspend(); h.dispose(); assert.equal(f.memory.read(), null); assert.equal(f.commands.length, 0);
  await f.controller.refresh(); f.memory.verify(f.controller.getEditorBinding()); assert.equal(f.memory.read()?.value, 'Private unsent');
  f.memory.conceal(); f.controller.suspend(); f.otherOwner(); await f.controller.refresh(); f.memory.verify(f.controller.getEditorBinding());
  assert.equal(f.memory.read(), null); assert.equal(f.memory.hasDraft(), false); assert.equal(f.commands.length, 0);
});
