/** Only safe HTTP error metadata from the future pinned fixed-child wrapper; no process/path facility. */
export function retryAfterSeconds(value:unknown):number|undefined{
 return typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<=3600?value:undefined;
}
export function httpStatus(value:unknown):number|undefined{
 return typeof value==='number'&&Number.isInteger(value)&&value>=100&&value<=599?value:undefined;
}
export class FixedBrokerHttpError extends Error{
 readonly status:number;readonly retryAfterSeconds?:number;
 constructor(status:number,hint?:unknown){
  super(status===401?'AUTH_REQUIRED':status===403?'ACCESS_DENIED':'REMOTE_TRANSPORT_UNCONFIRMED');
  if(httpStatus(status)!==status||status<300)throw Error('NATIVE_RESPONSE_REJECTED');
  this.status=status;const seconds=retryAfterSeconds(hint);if(seconds!==undefined)this.retryAfterSeconds=seconds;
 }
}
/** BrokerCommand.swift's pinned exit-1 HTTP error only. Nonzero output never gains a fingerprint/success binding. */
export function decodeFixedBrokerChildResult(code:number,raw:string):unknown{
 let data:unknown;try{data=JSON.parse(raw);}catch{throw Error('NATIVE_RESPONSE_REJECTED');}
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('NATIVE_RESPONSE_REJECTED');
 const value=data as Record<string,unknown>;
 if(code===0)return data; // The real channel independently validates the full fingerprint/RPC binding.
 const keys=Object.keys(value).filter(key=>key!=='retryAfterSeconds').sort().join(',');
 if(code===1&&keys==='error,status'&&value.error==='BROKER_HTTP_REJECTED'&&httpStatus(value.status)!==undefined&&(value.status as number)>=300)throw new FixedBrokerHttpError(value.status as number,value.retryAfterSeconds);
 throw Error('REMOTE_TRANSPORT_UNCONFIRMED');
}
