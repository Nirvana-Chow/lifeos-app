export type TasksAccess='unavailable'|'developer-review';
export type TasksAccountState='checking'|'not-signed-in'|'review-only'|'unavailable';
export function resolveTasksAccess(access:TasksAccess,accountState:TasksAccountState){
 if(accountState==='checking')return 'checking';
 if(accountState==='not-signed-in')return 'signed-out';
 if(access!=='developer-review')return 'owner-unavailable';
 return accountState==='review-only'?'developer-review':'service-unavailable';
}
