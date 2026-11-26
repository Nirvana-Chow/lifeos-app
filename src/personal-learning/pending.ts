import {commandOf} from './command.ts';
import type {Command} from './domain.ts';

export type Pending = {scope: string; key: string; body: string; command: Command};
type Store = Pick<Storage,'getItem'|'setItem'|'removeItem'>;

function storageKey(scope: string) {
  if (!/^[a-f0-9]{64}$/.test(scope)) throw new Error('词卡权限尚未核对。');
  return 'lifeos.learning.pending.v1:'+scope;
}
const encode = ({key,body}: Pending) => JSON.stringify({key,body});

export function readPending(store: Store, scope: string): Pending | null {
  const value = store.getItem(storageKey(scope));
  if (!value) return null;
  try {
    if (value.length > 32_000) throw new Error();
    const {key, body} = JSON.parse(value);
    if (typeof key !== 'string' || !/^learning-[a-f0-9-]{36}$/.test(key) || typeof body !== 'string') throw new Error();
    return {scope,key,body,command:commandOf(JSON.parse(body))};
  } catch {
    throw new Error('保留的词卡请求无法核对，请保留当前页签。');
  }
}

export function retainPending(store: Store, pending: Pending) {
  const name = storageKey(pending.scope), value = encode(pending);
  const current = store.getItem(name);
  if (current && current !== value) throw new Error('词卡还有待确认的请求。');
  store.setItem(name,value);
  if (store.getItem(name) !== value) throw new Error('词卡请求未保留。');
}

export function clearPending(store: Store, pending: Pending) {
  try {
    const name = storageKey(pending.scope);
    if (store.getItem(name) !== encode(pending)) return false;
    store.removeItem(name);
    return store.getItem(name) === null;
  } catch {
    return false;
  }
}
