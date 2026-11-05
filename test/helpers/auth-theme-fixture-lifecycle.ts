import type {ChildProcess} from 'node:child_process';
import {rm} from 'node:fs/promises';
import {basename,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
export type FixtureProcess={child:ChildProcess;group:boolean;exited:Promise<void>;closed:Promise<void>;hasExited:()=>boolean;hasClosed:()=>boolean};
export type FixtureBrowserServer={close:()=>Promise<void>;kill:()=>Promise<void>};
/** Register immediately after spawn/launchServer, before any operation can fail. */
export function trackAuthThemeProcess(child:ChildProcess,group=false):FixtureProcess{
 let exited=child.exitCode!==null||child.signalCode!==null,closed=false;
 const exit=new Promise<void>(accept=>{if(exited)accept();child.once('exit',()=>{exited=true;accept();});child.on('error',()=>{if(!child.pid){exited=true;accept();}});});
 const close=new Promise<void>(accept=>child.once('close',()=>{closed=true;accept();}));
 return{child,group,exited:exit,closed:close,hasExited:()=>exited,hasClosed:()=>closed};
}
async function within<T>(promise:Promise<T>,ms:number,code:string):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(code)),ms);})]);}finally{clearTimeout(timer);}}
function signal(p:FixtureProcess,value:NodeJS.Signals){
 try{if(p.group&&p.child.pid)process.kill(-p.child.pid,value);else if(!p.hasExited())p.child.kill(value);}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw Error('process-signal-failed');}
}
export async function cleanupAuthThemeFixture(v:{root:string;browser?:{close:()=>Promise<void>};browserServer?:FixtureBrowserServer;browserProcess?:FixtureProcess;server?:FixtureProcess},timing={browserMs:3000,termMs:8000,killMs:2000}):Promise<void>{
 const failures:string[]=[];
 const capture=(error:unknown,fallback:string)=>{const code=error instanceof Error&&/^(?:browser|server|process|root)-[a-z-]+$/.test(error.message)?error.message:fallback;failures.push(code);};
 const stop=async(p:FixtureProcess|undefined,label:'browser'|'server')=>{
  if(!p||p.hasExited()&&p.hasClosed())return;
  try{signal(p,'SIGTERM');await within(Promise.all([p.exited,p.closed]),timing.termMs,label+'-term-timeout');}
  catch(error){capture(error,label+'-term-failed');
   try{signal(p,'SIGKILL');await within(Promise.all([p.exited,p.closed]),timing.killMs,label+'-kill-timeout');}
   catch(hardError){capture(hardError,label+'-kill-failed');}
  }
 };
 let browserCloseFailed=false,rootRemoved=false;
 try{
  try{if(v.browser)await within(v.browser.close(),timing.browserMs,'browser-close-timeout');}catch(error){browserCloseFailed=true;capture(error,'browser-close-failed');}
  if(v.browserServer){
   try{await within(browserCloseFailed?v.browserServer.kill():v.browserServer.close(),timing.browserMs,browserCloseFailed?'browser-kill-timeout':'browser-server-close-timeout');}
   catch(error){capture(error,'browser-server-close-failed');try{await within(v.browserServer.kill(),timing.killMs,'browser-kill-timeout');}catch(hardError){capture(hardError,'browser-kill-failed');}}
  }
 }finally{
  // Neither a rejected nor a forever-pending browser close can skip server stop.
  try{await stop(v.browserProcess,'browser');}finally{await stop(v.server,'server');}
 }
 const browserStopped=!v.browserProcess||v.browserProcess.hasExited()&&v.browserProcess.hasClosed(),serverStopped=!v.server||v.server.hasExited()&&v.server.hasClosed();
 if(browserStopped&&serverStopped){
  if(resolve(dirname(v.root))!==resolve(tmpdir())||!basename(v.root).startsWith('lifeos-auth-theme-'))failures.push('root-scope-invalid');
  else try{await rm(v.root,{recursive:true,force:true,maxRetries:3,retryDelay:100});rootRemoved=true;}catch{failures.push('root-remove-failed');}
 }
 console.log('AUTH_THEME_FIXTURE_CLEANUP '+JSON.stringify({browserStopped,serverStopped,rootRemoved,failures}));
 if(failures.length||!browserStopped||!serverStopped)throw Error('AUTH_THEME_FIXTURE_CLEANUP_FAILED');
}
