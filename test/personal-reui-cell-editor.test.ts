import test from 'node:test';
import assert from 'node:assert/strict';
import { mountTaskGridEditor } from '../src/personal-candidate/task-grid-editor.ts';
import type { PersonalEditorFields } from '../src/personal-candidate/editor.ts';

class Input extends EventTarget {
  value = '';
  disabled = false;
  focuses = 0;
  focus() { this.focuses++; }
  fire(type: string, extra: Record<string, unknown> = {}) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, extra);
    this.dispatchEvent(event);
    return event;
  }
}
const fields: PersonalEditorFields = {
  title: 'Original', text: 'Notes', date: '', status: 'open',
};
function fixture() {
  const input = new Input();
  let allowed = true, accepted = false, closed = 0;
  const submissions: Array<{ task: unknown; fields: PersonalEditorFields }> = [];
  const drafts: unknown[] = [];
  const errors: string[] = [];
  const advances: Array<'next' | 'previous'> = [];
  const editor = mountTaskGridEditor(input as unknown as HTMLInputElement, {
    task: { id: 'task-a', revision: 3 }, fields, field: 'title', value: 'Original',
    canSave: () => allowed,
    save: async (task, next) => {
      submissions.push({ task, fields: next });
      return accepted ? {} as never : null;
    },
    onDraft: draft => drafts.push(draft), onClose: () => { closed++; },
    onError: message => errors.push(message), onAdvance: direction => advances.push(direction),
  });
  return { input, editor, submissions, drafts, errors, advances,
    closed: () => closed, accept: () => { accepted = true; },
    writable: (value: boolean) => { allowed = value; editor.refreshAccess(); },
  };
}
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

test('composition Enter, legacy 229 and composing blur retain Chinese draft without submitting', async () => {
  const f = fixture();
  f.input.value = '中文待办'; f.input.fire('compositionstart'); f.input.fire('input');
  f.input.fire('keydown', { key: 'Enter', isComposing: true }); f.input.fire('blur');
  await tick(); assert.equal(f.submissions.length, 0);
  f.input.fire('compositionend');
  f.input.fire('keydown', { key: 'Enter', keyCode: 229 });
  await tick(); assert.equal(f.submissions.length, 0);
  assert.equal((f.drafts.at(-1) as any).value, '中文待办');
  f.accept(); f.input.fire('keydown', { key: 'Enter' }); await tick();
  assert.deepEqual(f.submissions, [{ task: { id: 'task-a', revision: 3 }, fields: { ...fields, title: '中文待办' } }]);
  assert.equal(f.closed(), 1); f.editor.dispose();
});

test('Tab waits for receipt; unknown and invalid retain input and focus, accepted Shift Tab advances', async () => {
  const f = fixture(); f.input.value = ' '; f.input.fire('input');
  f.input.fire('keydown', { key: 'Tab' }); await tick();
  assert.equal(f.submissions.length, 0); assert.equal(f.closed(), 0); assert.ok(f.errors.length);
  f.input.value = 'Corrected'; f.input.fire('input');
  f.input.fire('keydown', { key: 'Tab' }); await tick();
  assert.equal(f.submissions.length, 1); assert.equal(f.closed(), 0);
  assert.equal(f.input.value, 'Corrected'); assert.deepEqual(f.advances, []);
  assert.ok(f.input.focuses >= 3); assert.equal(f.input.disabled, false);
  f.accept(); f.input.fire('keydown', { key: 'Tab', shiftKey: true }); await tick();
  assert.equal(f.closed(), 1); assert.deepEqual(f.advances, ['previous']);
  assert.deepEqual(f.submissions[1], f.submissions[0]); f.editor.dispose();
});

test('blur submits through receipt bridge; denied access and Escape preserve pending draft', async () => {
  const f = fixture(); f.input.value = 'Retained'; f.input.fire('input');
  f.writable(false); f.input.fire('blur'); f.input.fire('keydown', { key: 'Escape' });
  await tick(); assert.equal(f.submissions.length, 0); assert.equal(f.closed(), 0);
  f.writable(true); f.input.fire('blur'); await tick();
  assert.equal(f.submissions.length, 1); assert.equal(f.closed(), 0);
  f.input.fire('keydown', { key: 'Escape' });
  assert.equal(f.closed(), 1); assert.equal(f.drafts.at(-1), null); f.editor.dispose();
});

test('dispose captures unsubmitted text, removes all native listeners, and ignores a late receipt', async () => {
  const input = new Input(); let resolve: (value: any) => void = () => {};
  const drafts: any[] = []; let closes = 0;
  const editor = mountTaskGridEditor(input as unknown as HTMLInputElement, {
    task: { id: 'task-a', revision: 3 }, fields, field: 'title', value: 'Original',
    canSave: () => true, save: () => new Promise(r => { resolve = r; }),
    onDraft: draft => drafts.push(draft), onClose: () => { closes++; }, onError: () => {},
  });
  input.value = 'Still private'; input.fire('input'); input.fire('keydown', { key: 'Enter' });
  editor.dispose(); resolve({}); await tick();
  assert.equal(closes, 0); assert.equal(drafts.at(-1).value, 'Still private');
  const count = drafts.length; input.value = 'After unmount'; input.fire('input'); input.fire('blur');
  assert.equal(drafts.length, count);
});

test('shared memory confirmation during save still advances Tab exactly once', async () => {
  const input = new Input(); let closes = 0, advances = 0;
  let editor: ReturnType<typeof mountTaskGridEditor>;
  editor = mountTaskGridEditor(input as unknown as HTMLInputElement, {
    task: { id: 'task-a', revision: 3 }, fields, field: 'title', value: 'Original',
    canSave: () => true,
    save: async () => { editor.confirm(); return {} as never; },
    onDraft: () => {}, onError: () => {}, onClose: () => { closes++; }, onAdvance: () => { advances++; },
  });
  input.value = 'Confirmed'; input.fire('input'); input.fire('keydown', { key: 'Tab' });
  await tick(); assert.equal(closes, 1); assert.equal(advances, 1); editor.dispose();
});
