import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForChatSignal} from '../src/platform/ark-chat.ts';

test('an already cancelled chat wait observes a previously started rejection without leaking its error',async()=>{
 const controller=new AbortController();controller.abort();
 await assert.rejects(()=>waitForChatSignal(Promise.reject(Error('synthetic late private chat error')),controller.signal),error=>{
  assert.ok(error instanceof Error);assert.equal((error as Error&{code:string}).code,'CHAT_CANCELLED');assert.doesNotMatch(error.message,/synthetic late private chat error/);return true;
 });
 await new Promise<void>(resolve=>setImmediate(resolve));
});
