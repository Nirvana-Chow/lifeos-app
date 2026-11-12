import {PlatformError} from '../platform/domain.ts';

/** Native API-key tryAgainIn is milliseconds; expose only bounded seconds. */
export class AgentRateLimitError extends PlatformError {
 readonly retryAfterSeconds?:number;
 constructor(nativeError:unknown){
  super(429,'RATE_LIMITED','请求过于频繁。');
  if(!nativeError||typeof nativeError!=='object'||Array.isArray(nativeError)||!('code' in nativeError)||nativeError.code!=='RATE_LIMITED'||!('details' in nativeError))return;
  const details=nativeError.details;
  if(!details||typeof details!=='object'||Array.isArray(details)||!('tryAgainIn' in details))return;
  const milliseconds=details.tryAgainIn;
  if(typeof milliseconds!=='number'||!Number.isFinite(milliseconds)||milliseconds<0||milliseconds>3_600_000)return;
  const seconds=Math.ceil(milliseconds/1000);
  if(Number.isInteger(seconds)&&seconds>=0&&seconds<=3600)this.retryAfterSeconds=seconds;
 }
}
