/** Copy a validated JSON record, binding, command, or editor field set. */
export function clonePersonalJSON<T extends object>(value:T):T {
 return typeof globalThis.structuredClone==='function'
  ?globalThis.structuredClone(value)
  :JSON.parse(JSON.stringify(value)) as T;
}
