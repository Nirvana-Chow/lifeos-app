import type {CaptureRun,CaptureRunRepository} from './contracts.ts';
import {verifyRestrictedPool,type SqlPool,type SqlClient} from '../platform/postgres.ts';
import {PlatformError,validateId} from '../platform/domain.ts';
import {checkedCaptureRun} from './repository.ts';

/** Read-only readiness check. It never executes the proposed migration. */
export async function verifyCaptureRunPool(pool:SqlPool):Promise<void>{
 await verifyRestrictedPool(pool);
 const client=await pool.connect();try{
  const result=await client.query(`SELECT (SELECT version FROM lifeos_platform.platform_capture_run_meta) AS version,
   (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lifeos_platform' AND c.relname='platform_capture_run' AND c.relrowsecurity) AS rls_tables,
   (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lifeos_platform' AND c.relname='platform_capture_run' AND c.relforcerowsecurity) AS forced_tables,
   (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid='lifeos_platform.platform_capture_run'::regclass) AS policies,
   (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid='lifeos_platform.platform_capture_run'::regclass AND p.polcmd='*' AND p.polpermissive AND p.polroles=ARRAY[0::oid]
    AND pg_get_expr(p.polqual,p.polrelid)='(owner_id = current_setting(''lifeos.owner_id''::text, true))'
    AND pg_get_expr(p.polwithcheck,p.polrelid)='(owner_id = current_setting(''lifeos.owner_id''::text, true))') AS owner_policies,
   has_table_privilege(current_user,'lifeos_platform.platform_capture_run_meta','SELECT') AND
   has_table_privilege(current_user,'lifeos_platform.platform_capture_run','SELECT') AND has_table_privilege(current_user,'lifeos_platform.platform_capture_run','INSERT') AND
   NOT EXISTS(SELECT 1 FROM unnest(ARRAY['revision','state','updated_at','confirmation_hash','record']) a(column_name) WHERE NOT has_column_privilege(current_user,'lifeos_platform.platform_capture_run',a.column_name,'UPDATE')) AS required,
   EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lifeos_platform' AND c.relname IN ('platform_capture_run_meta','platform_capture_run') AND
    CASE WHEN c.relname='platform_capture_run' THEN has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND (has_column_privilege(current_user,c.oid,a.attnum,'REFERENCES') OR (a.attname NOT IN ('revision','state','updated_at','confirmation_hash','record') AND has_column_privilege(current_user,c.oid,a.attnum,'UPDATE'))))
    ELSE has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE,REFERENCES') END) AS excessive`);
  const metadata=result.rows[0];
  if(result.rows.length!==1||metadata.version!==1||metadata.rls_tables!==1||metadata.forced_tables!==1||metadata.policies!==1||metadata.owner_policies!==1||metadata.required!==true||metadata.excessive!==false)throw Error('Restricted capture run extension v1 required');
 }finally{client.release();}
}

const select='SELECT id::text,owner_id,kind,adapter,source_hash,provenance,revision,state,created_at,updated_at,confirmation_hash,record FROM lifeos_platform.platform_capture_run';
const conflict=()=>new PlatformError(409,'CAPTURE_RUN_CONFLICT','运行凭证已变化，请重新读取。');
const unavailable=()=>new PlatformError(503,'CAPTURE_RUN_STORAGE_UNAVAILABLE','运行凭证暂时无法核对。');
const immutable=['id','ownerId','kind','adapter','sourceHash','provenance','createdAt'] as const;
function same(a:unknown,b:unknown):boolean{
 if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const left=a as Record<string,unknown>,right=b as Record<string,unknown>,keys=Object.keys(left);
 return keys.length===Object.keys(right).length&&keys.every(key=>Object.hasOwn(right,key)&&same(left[key],right[key]));
}
function decode(owner:string,rows:Record<string,unknown>[],id:string):CaptureRun|null{
 if(rows.length>1)throw unavailable();const row=rows[0];if(!row)return null;
 const iso=(value:unknown)=>value instanceof Date?value.toISOString():value;
 return checkedCaptureRun(owner,{id:row.id,ownerId:row.owner_id,kind:row.kind,adapter:row.adapter,sourceHash:row.source_hash,provenance:row.provenance,revision:row.revision,state:row.state,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),confirmationHash:row.confirmation_hash,record:row.record},id);
}
export class PostgresCaptureRunRepository implements CaptureRunRepository{
 private pool:SqlPool;constructor(pool:SqlPool){this.pool=pool;}
 private async scoped<T>(owner:string,action:(client:SqlClient)=>Promise<T>,readOnly=false):Promise<T>{
  const client=await this.pool.connect();try{
   await client.query(readOnly?'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY':'BEGIN ISOLATION LEVEL READ COMMITTED');
   await client.query("SELECT set_config('lifeos.owner_id',$1,true)",[owner]);
   const value=await action(client);await client.query('COMMIT');return value;
  }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
 }
 async get(owner:string,inputId:string):Promise<CaptureRun|null>{
  const id=validateId(inputId);return this.scoped(owner,async client=>decode(owner,(await client.query(select+' WHERE owner_id=$1 AND id=$2',[owner,id])).rows,id),true);
 }
 async change(owner:string,inputId:string,fn:(previous:CaptureRun|null)=>CaptureRun):Promise<CaptureRun>{
  const id=validateId(inputId);return this.scoped(owner,async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['capture-run',owner,id])]);
   const previous=decode(owner,(await client.query(select+' WHERE owner_id=$1 AND id=$2 FOR UPDATE',[owner,id])).rows,id);
   // Never let an in-place callback mutation change the baseline used to check
   // immutable metadata. State graph decisions belong to the capture service.
   const next=checkedCaptureRun(owner,fn(previous?structuredClone(previous):null),id);
   if(previous){
    if(same(previous,next))return previous;
    if(immutable.some(key=>!same(previous[key],next[key]))||next.revision!==previous.revision+1||next.updatedAt<previous.updatedAt)throw conflict();
    const result=await client.query('UPDATE lifeos_platform.platform_capture_run SET revision=$3,state=$4,updated_at=$5,confirmation_hash=$6,record=$7::jsonb WHERE owner_id=$1 AND id=$2 AND revision=$8',[owner,id,next.revision,next.state,next.updatedAt,next.confirmationHash,next.record===null?null:JSON.stringify(next.record),previous.revision]);
    if(result.rowCount!==1)throw conflict();
   }else{
    if(next.state!=='pending'||next.revision!==1||next.updatedAt!==next.createdAt)throw conflict();
    const result=await client.query('INSERT INTO lifeos_platform.platform_capture_run(owner_id,id,kind,adapter,source_hash,provenance,revision,state,created_at,updated_at,confirmation_hash,record) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12::jsonb)',[owner,id,next.kind,next.adapter,next.sourceHash,next.provenance===null?null:JSON.stringify(next.provenance),next.revision,next.state,next.createdAt,next.updatedAt,next.confirmationHash,next.record===null?null:JSON.stringify(next.record)]);
    if(result.rowCount!==1)throw conflict();
   }
   return next;
  });
 }
}
