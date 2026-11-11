import {PlatformError} from '../platform/domain.ts';
import type {SqlClient,SqlPool} from '../platform/postgres.ts';
import type {NotificationWait} from './http.ts';
type Client=SqlClient&{on(event:string,listener:(message?:{channel?:string})=>void):void;off(event:string,listener:(message?:{channel?:string})=>void):void};
/** NOTIFY is a bounded wake-up hint, never event storage or an authorization proof. */
export async function openRequirementNotifications(pool:SqlPool):Promise<NotificationWait>{
 const client=await pool.connect() as Client;let pending=false,closed=false,failed=false,wake:(()=>void)|undefined;
 const notify=(message?:{channel?:string})=>{if(message?.channel==='lifeos_requirement_events'){pending=true;wake?.();}};
 const error=()=>{failed=true;wake?.();};
 client.on('notification',notify);client.on('error',error);
 try{await client.query('LISTEN lifeos_requirement_events');}catch(cause){client.off('notification',notify);client.off('error',error);client.release();throw cause;}
 return{
  async wait(signal){signal.throwIfAborted();if(failed||closed)throw Error('EVENT_NOTIFIER_UNAVAILABLE');if(pending){pending=false;return;}
   await new Promise<void>((resolve,reject)=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);wake=undefined;resolve();};const abort=()=>{clearTimeout(timer);wake=undefined;reject(Error('EVENT_STREAM_ABORTED'));};const timer=setTimeout(done,15000);wake=done;signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});pending=false;if(failed||closed)throw Error('EVENT_NOTIFIER_UNAVAILABLE');
  },
  async close(){if(closed)return;closed=true;wake?.();client.off('notification',notify);try{await client.query('UNLISTEN lifeos_requirement_events');}finally{client.off('error',error);client.release();}}
 };
}

/** One active acquisition per runtime, including the await-ready/open phase.
 * Additional requests fail immediately; they never queue behind a long LISTEN. */
export function singleRequirementNotifications(open:()=>Promise<NotificationWait>):()=>Promise<NotificationWait>{
 let active=false;
 return async()=>{
  if(active)throw new PlatformError(503,'EVENT_LISTENER_BUSY','事件连接已占用。');active=true;
  try{const source=await open();let released=false;return{wait:source.wait.bind(source),close:async()=>{if(released)return;released=true;try{await source.close();}finally{active=false;}}};}
  catch(error){active=false;throw error;}
 };
}
