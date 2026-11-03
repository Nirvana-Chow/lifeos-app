import{agentRuntimeKeys,readAgentRuntimeConfig}from'../agent-api/config.ts';
import{personalConfigKeys,readPersonalConfig}from'../personal-candidate/config.ts';
import{readCaptureRunCandidateFlag}from'../capture-runs-candidate/config.ts';
import{readChatCandidateFlag}from'../chat-candidate/config.ts';
import{openSync,closeSync,fstatSync,readFileSync,constants}from'node:fs';import{readPlatformConfig}from'./config.ts';import{aiSettingsRuntimeKeys,readAISettingsRuntimeConfig}from'./ai-settings-config.ts';
import{readCalendarCandidateFlag}from'./calendar-config.ts';
export const reviewDatabase='lifeos_platform_test_local';
export function readPrivateObject(path:string):Record<string,unknown>{
 let fd:number|undefined;try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const st=fstatSync(fd);if(!st.isFile()||st.size>16384||(st.mode&0o077)!==0||st.uid!==process.getuid?.())throw Error();const raw=readFileSync(fd);if(raw.length>16384)throw Error();const value=JSON.parse(raw.toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw Error('Isolated review configuration unavailable');}finally{if(fd!==undefined)closeSync(fd);}
}
export function readReviewConfig(path:string):Record<string,string>{
 return validateReviewConfig(readPrivateObject(path));
}
/** Same strict allowlist for the reviewed host adapter; file ownership remains
 * the caller's responsibility and readReviewConfig still checks it first. */
export function validateReviewConfig(value:Record<string,unknown>):Record<string,string>{
 try{
  const keys=['LIFEOS_PLATFORM_CANDIDATE','LIFEOS_PLATFORM_TARGET','LIFEOS_PLATFORM_BASE_URL','LIFEOS_PLATFORM_OWNER_ID','LIFEOS_PLATFORM_OWNER_EMAIL','LIFEOS_PLATFORM_SECRET','LIFEOS_PLATFORM_TEST_DATABASE_URL'];
  if(value.LIFEOS_PLATFORM_TRANSPORT==='https-origin')keys.push('LIFEOS_PLATFORM_TRANSPORT','LIFEOS_PLATFORM_HTTPS_HOST');
  keys.push(...aiSettingsRuntimeKeys.filter(k=>value[k]!==undefined),...personalConfigKeys.filter(k=>value[k]!==undefined),...agentRuntimeKeys.filter(k=>value[k]!==undefined));
  for(const key of ['LIFEOS_CALENDAR_CANDIDATE','LIFEOS_CHAT_CANDIDATE','LIFEOS_CAPTURE_RUNS_CANDIDATE'])if(value[key]!==undefined)keys.push(key);
  if(Object.keys(value).length!==keys.length||keys.some(k=>k!=='LIFEOS_PERSONAL_RECOVERY_APPROVAL'&&typeof value[k]!=='string'))throw Error();
  const env={...value} as Record<string,string>;if(typeof value.LIFEOS_PERSONAL_RECOVERY_APPROVAL!=='string')delete env.LIFEOS_PERSONAL_RECOVERY_APPROVAL;const config=readPlatformConfig(env);if(!config)throw Error();
  const personal=readPersonalConfig(env,config);readAgentRuntimeConfig(env,config,personal);
  if(personal){
   // Personal mode is manual-only. It cannot inherit optional model, import or fixture capabilities.
   if([...aiSettingsRuntimeKeys,'LIFEOS_CALENDAR_CANDIDATE','LIFEOS_CHAT_CANDIDATE','LIFEOS_CAPTURE_RUNS_CANDIDATE'].some(k=>value[k]!==undefined))throw Error();
  }else if(personalConfigKeys.some(k=>value[k]!==undefined)||env.LIFEOS_PLATFORM_TRANSPORT!=='https-origin'&&config.baseURL!=='http://127.0.0.1:3002'||config.ownerId!=='fixture-owner-a'||config.ownerEmail!=='fixture@example.invalid')throw Error();
  readAISettingsRuntimeConfig(env,config.baseURL);readCalendarCandidateFlag(env);readChatCandidateFlag(env);readCaptureRunCandidateFlag(env);
  const db=new URL(config.databaseURL);if(db.pathname!=='/'+reviewDatabase||db.port!=='55432')throw Error();return Object.freeze(env);
 }catch{throw Error('Isolated review configuration unavailable');}
}

/** Only a validated private file may set this launcher's optional capture flag. */
export function loadReviewEnvironment(path:string,env:Record<string,string|undefined>):void{
 applyReviewEnvironment(readReviewConfig(path),env);
}

/** Pure application of an already read configuration; never reopen its source. */
export function applyReviewEnvironment(value:Record<string,string>,env:Record<string,string|undefined>):void{
 const config=validateReviewConfig(value);delete env.LIFEOS_CAPTURE_RUNS_CANDIDATE;for(const key of [...personalConfigKeys,...agentRuntimeKeys])delete env[key];delete env.LIFEOS_PERSONAL_BOOTSTRAP;delete env.LIFEOS_PERSONAL_BOOTSTRAP_DATABASE_URL;Object.assign(env,config);
}
