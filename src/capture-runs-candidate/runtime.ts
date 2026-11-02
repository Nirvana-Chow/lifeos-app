import {readCaptureRunCandidateFlag} from './config.ts';
import {verifyCaptureRunPool,PostgresCaptureRunRepository} from './postgres.ts';
import {readPlatformConfig} from '../platform/config.ts';
import type {SqlPool} from '../platform/postgres.ts';
import type {CaptureRunRepository} from './contracts.ts';
/** Optional metadata only. Verification reads catalogs; it never migrates or grants. */
export async function initializeCaptureRuns(env:Record<string,string|undefined>,pool?:SqlPool):Promise<{state:'disabled'|'ready'|'unavailable';repository?:CaptureRunRepository}>{
 try{
  if(!readCaptureRunCandidateFlag(env))return{state:'disabled'};
  if(!pool||!readPlatformConfig(env))return{state:'unavailable'};
  await verifyCaptureRunPool(pool);
  return{state:'ready',repository:new PostgresCaptureRunRepository(pool)};
 }catch{return{state:'unavailable'};}
}
