import {object,PlatformError, validateTodo} from '../platform/domain.ts';
import type {PublicEntry} from '../platform/contracts.ts';

export const todoOriginalLineLimit = 4096;
export const todoOriginalLinePattern = /^(?:[^\r\n\u0000\u2028\u2029\uD800-\uDFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])*$/;

export function validateTodoOriginalLine(value: unknown): string {
 if (typeof value !== 'string' || value.length > todoOriginalLineLimit || !todoOriginalLinePattern.test(value)) {
  throw new PlatformError(400, 'INVALID_TODO_ORIGINAL_LINE', '原始输入需要是一行文字，最多4096个字符。');
 }
 return value;
}

export type TodoCaptureChannel='owner-web'|'agent-api';
type TodoExpression='written'|'spoken';

export function validateTodoExpression(value:unknown):TodoExpression {
 if(value!=='written'&&value!=='spoken')throw new PlatformError(400,'INVALID_TODO_EXPRESSION','表达类型无效。');
 return value;
}

export function readManualTodoSource(value:unknown,spaceId:string){
 const original=object(value,['marker','type','spaceId','input','capture']);
 if(original.marker!=='personal-manual-v1'||original.type!=='todo'||original.spaceId!==spaceId)throw Error('待办来源无法核对。');
 const input=object(original.input,['spaceId','confirmed','fields','originalLine','expression']);
 if(input.spaceId!==spaceId||input.confirmed!==true)throw Error('待办空间无法核对。');
 const initial=validateTodo(input.fields);
 const originalLine=Object.hasOwn(input,'originalLine')?validateTodoOriginalLine(input.originalLine):undefined;
 const expression=Object.hasOwn(input,'expression')?validateTodoExpression(input.expression):null;
 let channel:TodoCaptureChannel|null=null;
 if(Object.hasOwn(original,'capture')){
  const capture=object(original.capture,['version','channel','expression']);
  if(capture.version!==1||(capture.channel!=='owner-web'&&capture.channel!=='agent-api')||capture.expression!==expression)throw Error('待办录入通道无法核对。');
  channel=capture.channel;
 }else if(expression!==null)throw Error('待办录入通道无法核对。');
 return {original,originalLine,initial,channel};
}

/** Preserve the existing legacy client envelope contract and verify all capture additions. */
export function readTodoClientEnvelope(value:unknown,spaceId:string){
 const original=object(value,['marker','type','spaceId','input','capture']);
 const input=original.input;
 if(Object.hasOwn(original,'capture')||(input&&typeof input==='object'&&
  (Object.hasOwn(input,'originalLine')||Object.hasOwn(input,'expression')))){
  return readManualTodoSource(original,spaceId);
 }
 return {original,channel:null};
}

export function todoCaptureSource(entry: PublicEntry, spaceId: string) {
 const source = entry.source;
 if (entry.kind !== 'todo' || source.system !== 'website' || source.externalId !== entry.id || source.version !== 1) return null;
 try {
  const {originalLine,initial}=readManualTodoSource(source.original,spaceId);
  return originalLine===undefined?null:{originalLine,initial};
 } catch {
  return null;
 }
}
