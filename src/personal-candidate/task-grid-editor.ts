import type { PersonalEditorFields } from './editor.ts';
import type { PublicEntry } from '../platform/contracts.ts';
import type { TaskCellDraft, TaskCellField } from './task-cell-draft.ts';
import { receiptEditor, type NativeReceiptEditor, type TaskIdentity } from './task-editor-state.ts';

type TaskGridEditorOptions = {
  task: TaskIdentity;
  fields: PersonalEditorFields;
  field: TaskCellField;
  value: string;
  canSave: () => boolean;
  save: (task: TaskIdentity, fields: PersonalEditorFields) => Promise<PublicEntry | null>;
  onDraft: (draft: TaskCellDraft | null) => void;
  onClose: () => void;
  onError: (message: string) => void;
  onAdvance?: (direction: 'next' | 'previous') => void;
};

/** DOM input adapter only. Validation, submission and draft ownership stay in the existing receipt bridge. */
export function mountTaskGridEditor(
  input: HTMLInputElement | HTMLSelectElement,
  options: TaskGridEditorOptions,
) {
  let active = true;
  let closed = false;
  let composing = false;
  let committing = false;
  let advance: 'next' | 'previous' | null = null;
  const native: NativeReceiptEditor = {
    onStart() { input.value = options.value; input.focus(); },
    onEnd() {},
    getValue: () => input.value,
    getInputElement: () => input,
    isEditorElement: target => target === input,
  };
  const editor = receiptEditor(native, {
    field: options.field,
    capture: () => ({ task: { ...options.task }, fields: structuredClone(options.fields) }),
    canSave: () => options.canSave() && !composing,
    active: () => active && !closed,
    save: options.save,
    onDraft: options.onDraft,
    onError: options.onError,
    style() {},
    cancel() {
      if (!active || closed) return;
      closed = true;
      editor.onEnd();
      options.onClose();
      if (advance) options.onAdvance?.(advance);
    },
  });

  async function commit(direction: 'next' | 'previous' | null = null) {
    if (!active || closed || composing || committing || !options.canSave()) return;
    committing = true;
    advance = direction;
    try {
      await editor.validateValue!(input.value, options.value);
    } finally {
      committing = false;
      advance = null;
      if (active && !closed && options.canSave()) input.focus();
    }
  }
  const compositionStart = () => { composing = true; };
  const compositionEnd = () => { composing = false; editor.captureDraft(); };
  const keydown = (raw: Event) => {
    const event = raw as KeyboardEvent;
    // IME confirmation is not a submission, including WebKit's legacy 229 event.
    if (composing || event.isComposing || event.keyCode === 229) {
      event.stopPropagation();
      return;
    }
    if (event.key !== 'Enter' && event.key !== 'Tab') return;
    event.preventDefault();
    event.stopPropagation();
    void commit(event.key === 'Tab' ? event.shiftKey ? 'previous' : 'next' : null);
  };
  const blur = () => { void commit(); };
  input.addEventListener('compositionstart', compositionStart);
  input.addEventListener('compositionend', compositionEnd);
  input.addEventListener('keydown', keydown);
  input.addEventListener('blur', blur);
  // The native adapter does not consume vendor geometry; this context never reaches a grid writer.
  editor.onStart({ value: options.value });
  editor.setDisabled(!options.canSave());

  return {
    captureDraft: editor.captureDraft,
    confirm() {
      if (!active || closed) return;
      editor.discard();
      closed = true;
      editor.onEnd();
      options.onClose();
      if (advance) options.onAdvance?.(advance);
    },
    refreshAccess() { editor.setDisabled(!options.canSave()); },
    dispose() {
      if (!active) return;
      active = false;
      editor.onEnd();
      input.removeEventListener('compositionstart', compositionStart);
      input.removeEventListener('compositionend', compositionEnd);
      input.removeEventListener('keydown', keydown);
      input.removeEventListener('blur', blur);
    },
  };
}
