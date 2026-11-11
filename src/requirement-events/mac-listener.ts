import {setTimeout as delay} from 'node:timers/promises';
import type {Work} from './contracts.ts';
import type {DurableRequirementQueue,RequirementDispatcher} from './mac-dispatcher.ts';
/** Only the reviewed native broker implements this port. JavaScript never receives an API key. */
export type NativeRequirementEventChannel={connect:(input:{cursor:string},signal:AbortSignal)=>AsyncIterable<{cursor:string;ready:Work[];reset?:boolean}>};
export async function listenForRequirementEvents(options:{enabled?:boolean;channel:NativeRequirementEventChannel;queue:DurableRequirementQueue;dispatcher:RequirementDispatcher;signal:AbortSignal;wait?:(ms:number,signal:AbortSignal)=>Promise<void>}){
 if(options.enabled!==true)throw Error('REQUIREMENT_LISTENER_DISABLED');
 const wait=options.wait??(async(ms:number,signal:AbortSignal)=>{await delay(ms,undefined,{signal});});let failures=0;
 while(!options.signal.aborted){
  try{
   const state=await options.queue.snapshot();
   for await(const batch of options.channel.connect({cursor:state.cursor},options.signal)){
    options.signal.throwIfAborted();await options.queue.ingest(batch);failures=0;
    // No timer launches a model. Empty/heartbeat frames perform no dispatch.
    if(batch.ready.length){while(await options.dispatcher.drain()>0){options.signal.throwIfAborted();}}
   }
  }catch{if(options.signal.aborted)return;}
  failures=Math.min(failures+1,6);try{await wait(Math.min(60000,1000*2**(failures-1)),options.signal);}catch{if(options.signal.aborted)return;throw Error('EVENT_RECONNECT_UNAVAILABLE');}
 }
}
/** A line-boundary decoder for the broker's credential-free JSONL, not raw network SSE. */
export async function* decodeNativeEventLines(chunks:AsyncIterable<Uint8Array>){
 const decoder=new TextDecoder('utf-8',{fatal:true});let pending='';
 for await(const chunk of chunks){pending+=decoder.decode(chunk,{stream:true});if(Buffer.byteLength(pending)>256*1024)throw Error('EVENT_FRAME_TOO_LARGE');
  for(;;){const at=pending.indexOf('\n');if(at<0)break;const line=pending.slice(0,at);pending=pending.slice(at+1);if(!line.trim())continue;const value=JSON.parse(line);if(value?.error)throw Error('NATIVE_EVENT_STREAM_UNAVAILABLE');if(!value||Object.keys(value).some(key=>!['cursor','events','ready','reset','readyTruncated'].includes(key))||typeof value.cursor!=='string'||!Array.isArray(value.ready)||value.ready.length>100)throw Error('INVALID_EVENT_FRAME');yield value as {cursor:string;ready:Work[];reset?:boolean};}
 }
 pending+=decoder.decode();if(pending.trim())throw Error('TRUNCATED_EVENT_FRAME');
}
