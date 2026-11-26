import assert from 'node:assert/strict';
import test from 'node:test';
import {mountTaskGridEditor} from '../src/personal-candidate/task-grid-editor.ts';
import type {TaskCellDraft} from '../src/personal-candidate/task-cell-draft.ts';
import type {PublicEntry} from '../src/platform/contracts.ts';

class FixtureElement extends EventTarget {
  private readonly searchFocus: boolean;
  constructor(searchFocus = false) {
    super();
    this.searchFocus = searchFocus;
  }
  closest(selector: string) {
    return this.searchFocus && selector === '[data-personal-search-focus]' ? this : null;
  }
}

function fixture() {
  const ownerDocument = new EventTarget();
  const input = Object.assign(new FixtureElement(), {ownerDocument, value: '', disabled: false, focus() {}});
  const search = new FixtureElement(true);
  const outside = new FixtureElement();
  const title = 'Unsaved synthetic task title';
  const writes: string[] = [];
  let draft: TaskCellDraft | null = null;
  let closed = 0;
  const editor = mountTaskGridEditor(input as unknown as HTMLInputElement, {
    task: {id: '11111111-1111-4111-8111-111111111111', revision: 1},
    fields: {title: 'Synthetic task title', text: '', date: '', status: 'open'},
    field: 'title',
    value: 'Synthetic task title',
    canSave: () => true,
    async save(task, fields) {
      writes.push(fields.title);
      return {...task, revision: 2} as PublicEntry;
    },
    onDraft: next => { draft = next; },
    onClose: () => { closed++; },
    onError: message => assert.fail(message),
  });
  input.value = title;
  function dispatch(host: EventTarget, type: string, properties: object) {
    host.dispatchEvent(Object.assign(new Event(type, {cancelable: true}), properties));
  }
  return {
    title, writes, search, outside,
    draft: () => draft,
    closed: () => closed,
    gesture: (type: string, target: FixtureElement, properties: object = {}) => {
      const event = Object.assign(new Event(type), {button: 0, ...properties});
      Object.defineProperty(event, 'target', {value: target});
      ownerDocument.dispatchEvent(event);
    },
    blur: (relatedTarget: FixtureElement | null) => dispatch(input, 'blur', {relatedTarget}),
    key: (key: string) => dispatch(input, 'keydown', {key, isComposing: false, keyCode: 0}),
    dispose: editor.dispose,
  };
}
const settled = () => new Promise<void>(resolve => setImmediate(resolve));

test('header search focus keeps unsaved tasks without changing ordinary commits', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Element');
  Object.defineProperty(globalThis, 'Element', {value: FixtureElement, configurable: true});
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'Element', descriptor);
    else Reflect.deleteProperty(globalThis, 'Element');
  });
  for (const input of ['mouse', 'touch', 'keyboard'] as const) {
    await t.test(input + ' search activation and Escape keep the draft', async t => {
      const f = fixture();
      t.after(f.dispose);
      if (input === 'mouse') f.gesture('mousedown', f.search);
      if (input === 'touch') f.gesture('pointerdown', f.search, {pointerType: 'touch', isPrimary: true});
      f.blur(input === 'keyboard' ? f.search : null);
      if (input !== 'keyboard') f.gesture(input === 'mouse' ? 'mouseup' : 'pointerup', f.search);
      f.gesture('click', f.search);
      f.gesture('keydown', f.search, {key: 'Escape'});
      await settled();
      assert.deepEqual(f.writes, []);
      assert.equal(f.closed(), 0);
      assert.equal(f.draft()?.value, f.title);
      f.key('Enter');
      await settled();
      assert.deepEqual(f.writes, [f.title]);
      assert.equal(f.closed(), 1);
    });
  }

  for (const exit of ['outside', 'null-outside', 'cancelled-press', 'released-press'] as const) {
    await t.test(exit + ' still commits on external blur', async t => {
      const f = fixture();
      t.after(f.dispose);
      if (exit === 'cancelled-press' || exit === 'released-press') {
        f.gesture('pointerdown', f.search, {pointerType: 'touch', isPrimary: true});
        f.gesture(exit === 'cancelled-press' ? 'pointercancel' : 'pointerup', f.search);
      }
      if (exit === 'null-outside') f.gesture('mousedown', f.outside);
      f.blur(exit === 'outside' ? f.outside : null);
      await settled();
      assert.deepEqual(f.writes, [f.title]);
      assert.equal(f.closed(), 1);
    });
  }
});
