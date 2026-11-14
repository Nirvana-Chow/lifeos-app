/** Session limits are server policy, never a client-provided expiry timestamp. */
export const temporarySessionSeconds=1800;
export const maximumFixedSessionSeconds=365*86400;
export const rollingSessionSeconds=400*86400;
export type SessionDuration={mode:'fixed';seconds:number}|{mode:'rolling'};
export type StoredSessionDuration={mode:'fixed'|'rolling';seconds:number};
export function parseSessionDuration(value:unknown):StoredSessionDuration{
 if(value===undefined)return{mode:'fixed',seconds:temporarySessionSeconds};
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_SESSION_DURATION');
 const input=value as Record<string,unknown>,keys=Object.keys(input);
 if(input.mode==='rolling'&&keys.length===1)return{mode:'rolling',seconds:rollingSessionSeconds};
 if(input.mode==='fixed'&&keys.length===2&&keys.includes('seconds')&&typeof input.seconds==='number'&&Number.isInteger(input.seconds)&&input.seconds>=60&&input.seconds<=maximumFixedSessionSeconds)return{mode:'fixed',seconds:input.seconds};
 throw Error('INVALID_SESSION_DURATION');
}
export function storedSessionDuration(session:Record<string,unknown>):StoredSessionDuration{
 if(session.sessionDurationMode==='rolling'&&session.sessionDurationSeconds===rollingSessionSeconds)return{mode:'rolling',seconds:rollingSessionSeconds};
 if(session.sessionDurationMode==='fixed')return parseSessionDuration({mode:'fixed',seconds:session.sessionDurationSeconds});
 throw Error('INVALID_STORED_SESSION_DURATION');
}
export const sessionDurationFields={
 sessionDurationMode:{type:'string' as const,required:true,defaultValue:'fixed',input:false as const},
 sessionDurationSeconds:{type:'number' as const,required:true,defaultValue:temporarySessionSeconds,input:false as const},
};
export function freshAuthentication(createdAt:unknown,now=Date.now()):boolean{
 const at=createdAt instanceof Date?createdAt.valueOf():typeof createdAt==='string'?new Date(createdAt).valueOf():NaN;
 return Number.isFinite(at)&&at<=now&&now-at<temporarySessionSeconds*1000;
}
