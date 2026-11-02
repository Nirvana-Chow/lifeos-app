import{isHTTPSOrigin}from'./config.ts';
// Container target only. A future approved deployment must explicitly bind the
// separate host-side key file here read-only; the current updater does not.
export const aiMasterKeyPath='/run/lifeos-platform/ai-master-key.json';
export const aiSettingsRuntimeKeys=['LIFEOS_AI_SETTINGS_CANDIDATE','LIFEOS_AI_MASTER_KEY_FILE','LIFEOS_AI_EXTERNAL_CALLS_APPROVED','LIFEOS_AI_DATA_APPROVED','LIFEOS_AI_BUDGET_APPROVED']as const;
export function readAISettingsRuntimeConfig(env:Record<string,string|undefined>,baseURL:string){
 const present=aiSettingsRuntimeKeys.filter(k=>env[k]!==undefined);if(!present.length)return null;
 const fail=():never=>{throw Error('Approved AI settings configuration required');};
 if(env.LIFEOS_AI_SETTINGS_CANDIDATE!=='1')return fail();
 const flags=aiSettingsRuntimeKeys.slice(2).map(k=>env[k]);if(flags.some(v=>v!==undefined&&v!=='0'&&v!=='1'))return fail();
 const approved=flags.every(v=>v==='1');if(flags.some(v=>v==='1')&&!approved)return fail();
 const masterKeyFile=env.LIFEOS_AI_MASTER_KEY_FILE??null;
 if(masterKeyFile!==null&&(masterKeyFile!==aiMasterKeyPath||!isHTTPSOrigin(new URL(baseURL))))return fail();
 if(approved&&(!masterKeyFile||!isHTTPSOrigin(new URL(baseURL))))return fail();
 return{masterKeyFile,externalCallsApproved:approved,dataTransmissionApproved:approved,callBudgetApproved:approved};
}
