import type {SqlPool} from '../platform/postgres.ts';
import type {PersonalConfig} from '../personal-candidate/config.ts';
import type {SyncCapture} from './capture.ts';
import type {SyncPrincipal} from './store-contracts.ts';
import {createPostgresSyncCapture} from './capture.ts';
import {PostgresSyncRepository,verifyAppleSyncPool} from './postgres.ts';
import {AppleSyncService} from './service.ts';
import {createAppleSyncHandler} from './http.ts';
import {readAppleSyncConfig} from './config.ts';
export type AppleSyncRuntimeDependencies={principalReader?:(request:Request)=>Promise<SyncPrincipal|null>;assertWritable?:()=>Promise<void>};
/** No device verifier is installed by this module. Source activation alone never
 * starts capture, probes optional tables or inherits browser session authority. */
export async function initializeAppleSync(env:Record<string,string|undefined>,pool:SqlPool,personal:PersonalConfig,dependencies:AppleSyncRuntimeDependencies={}):Promise<{handler:(request:Request)=>Promise<Response>;capture:SyncCapture|undefined}>{
 const closed=()=>({handler:createAppleSyncHandler({baseURL:personal.baseURL}),capture:undefined});
 let enabled=false;try{enabled=readAppleSyncConfig(env).enabled;}catch{return closed();}
 if(!enabled||!dependencies.principalReader||!dependencies.assertWritable)return closed();
 try{
  await verifyAppleSyncPool(pool);
  const repository=new PostgresSyncRepository(pool,{ownerId:personal.ownerId,spaceId:personal.spaceId});
  const service=new AppleSyncService({repository,personal,assertWritable:dependencies.assertWritable});
  return{capture:createPostgresSyncCapture({ownerId:personal.ownerId,spaceId:personal.spaceId}),handler:createAppleSyncHandler({baseURL:personal.baseURL,enabled:true,service,principalReader:dependencies.principalReader})};
 }catch{return closed();}
}
