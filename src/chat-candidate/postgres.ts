import {chatPoint} from './export-page.ts';
import type {ChatPageWindow} from './contracts.ts';
import type{ChatRepository,ChatTurn,ChatTransition}from'./contracts.ts';
import{verifyRestrictedPool,type SqlPool,type SqlClient}from'../platform/postgres.ts';
import{PlatformError}from'../platform/domain.ts';
import{checkedChatId,checkedChatLimit,checkedChatReservation,checkedChatTransition,checkedChatTurn,nextChatTurn,sameChatReservation}from'./repository.ts';

/** Metadata-only readiness check. It never applies the proposed SQL extension. */
export async function verifyChatPool(pool:SqlPool):Promise<void>{
 await verifyRestrictedPool(pool);
 const client=await pool.connect();try{
  const result=await client.query(`SELECT (SELECT version FROM lifeos_platform.platform_chat_meta) AS version,
   (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lifeos_platform' AND c.relname='platform_chat_turn' AND c.relrowsecurity) AS rls_tables,
   (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lifeos_platform' AND c.relname='platform_chat_turn' AND c.relforcerowsecurity) AS forced_tables,
   (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid='lifeos_platform.platform_chat_turn'::regclass) AS policies,
   (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid='lifeos_platform.platform_chat_turn'::regclass AND p.polcmd='*' AND p.polpermissive AND p.polroles=ARRAY[0::oid]
    AND pg_get_expr(p.polqual,p.polrelid)='(owner_id = current_setting(''lifeos.owner_id''::text, true))'
    AND pg_get_expr(p.polwithcheck,p.polrelid)='(owner_id = current_setting(''lifeos.owner_id''::text, true))') AS owner_policies,
   has_table_privilege(current_user,'lifeos_platform.platform_chat_meta','SELECT') AND
   has_table_privilege(current_user,'lifeos_platform.platform_chat_turn','SELECT') AND has_table_privilege(current_user,'lifeos_platform.platform_chat_turn','INSERT') AND
   NOT EXISTS(SELECT 1 FROM unnest(ARRAY['assistant_text','state','revision','updated_at','error_code']) a(column_name) WHERE NOT has_column_privilege(current_user,'lifeos_platform.platform_chat_turn',a.column_name,'UPDATE')) AS required,
   EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='lifeos_platform' AND c.relname IN ('platform_chat_meta','platform_chat_turn') AND
    CASE WHEN c.relname='platform_chat_turn' THEN has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND (has_column_privilege(current_user,c.oid,a.attnum,'REFERENCES') OR (a.attname NOT IN ('assistant_text','state','revision','updated_at','error_code') AND has_column_privilege(current_user,c.oid,a.attnum,'UPDATE'))))
    ELSE has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE,REFERENCES') END) AS excessive`);
  const m=result.rows[0];if(result.rows.length!==1||m.version!==1||m.rls_tables!==1||m.forced_tables!==1||m.policies!==1||m.owner_policies!==1||m.required!==true||m.excessive!==false)throw Error('Restricted chat extension v1 required');
 }finally{client.release();}
}

const select='SELECT id::text,owner_id,digest,user_text,assistant_text,state,revision,created_at,updated_at,provenance,error_code FROM lifeos_platform.platform_chat_turn';
function decode(owner:string,row:Record<string,unknown>,id?:string):ChatTurn{
 const iso=(value:unknown)=>value instanceof Date?value.toISOString():value;
 return checkedChatTurn(owner,{id:row.id,ownerId:row.owner_id,userText:row.user_text,assistantText:row.assistant_text,state:row.state,revision:row.revision,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),provenance:row.provenance,errorCode:row.error_code},id);
}

export class PostgresChatRepository implements ChatRepository{
 private pool:SqlPool;constructor(pool:SqlPool){this.pool=pool;}
 private async scoped<T>(owner:string,action:(client:SqlClient)=>Promise<T>,readOnly=false):Promise<T>{
  const client=await this.pool.connect();try{await client.query(readOnly?'BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY':'BEGIN ISOLATION LEVEL READ COMMITTED');await client.query("SELECT set_config('lifeos.owner_id',$1,true)",[owner]);const value=await action(client);await client.query('COMMIT');return value;}catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}finally{client.release();}
 }
 async reserve(owner:string,proposed:ChatTurn,digest:string){
  const turn=checkedChatReservation(owner,proposed,digest);
  return this.scoped(owner,async client=>{
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['chat',owner,turn.id])]);
   const row=(await client.query(select+' WHERE owner_id=$1 AND id=$2 FOR UPDATE',[owner,turn.id])).rows[0];
   if(row){const previous=decode(owner,row,turn.id);sameChatReservation(previous,row.digest,turn,digest);return{created:false,turn:previous};}
   const written=await client.query('INSERT INTO lifeos_platform.platform_chat_turn(owner_id,id,digest,user_text,assistant_text,state,revision,created_at,updated_at,provenance,error_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)',[owner,turn.id,digest,turn.userText,turn.assistantText,turn.state,turn.revision,turn.createdAt,turn.updatedAt,JSON.stringify(turn.provenance),turn.errorCode]);
   if(written.rowCount!==1)throw new PlatformError(409,'CHAT_TURN_CONFLICT','聊天请求状态未确认，请重新读取。');
   return{created:true,turn};
  });
 }
 async get(owner:string,id:string):Promise<ChatTurn|null>{
  checkedChatId(id);return this.scoped(owner,async client=>{const row=(await client.query(select+' WHERE owner_id=$1 AND id=$2',[owner,id])).rows[0];return row?decode(owner,row,id):null;},true);
 }
 async list(owner:string,limit:number):Promise<ChatTurn[]>{
  checkedChatLimit(limit);return this.scoped(owner,async client=>(await client.query(select+' WHERE owner_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2',[owner,limit])).rows.map(row=>decode(owner,row)),true);
 }
 async page(owner:string,window:ChatPageWindow,limit:number):Promise<ChatTurn[]>{
  checkedChatLimit(limit);if(window.anchor)chatPoint(window.anchor);if(window.after)chatPoint(window.after);
  // Preserve PostgreSQL microseconds in cursor keys; JS Date would truncate them.
  const precise=select.replace('created_at,updated_at',`to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`);
  return this.scoped(owner,async client=>(await client.query(precise+' WHERE owner_id=$1 AND ($3::timestamptz IS NULL OR (created_at,id)<=($3::timestamptz,$4::uuid)) AND ($5::timestamptz IS NULL OR (created_at,id)<($5::timestamptz,$6::uuid)) ORDER BY platform_chat_turn.created_at DESC,platform_chat_turn.id DESC LIMIT $2',[owner,limit,window.anchor?.createdAt??null,window.anchor?.id??null,window.after?.createdAt??null,window.after?.id??null])).rows.map(row=>decode(owner,row)),true);
 }
 async transition(owner:string,id:string,expectedRevision:number,input:ChatTransition):Promise<ChatTurn>{
  checkedChatId(id);const change=checkedChatTransition(input);
  return this.scoped(owner,async client=>{
   const row=(await client.query(select+' WHERE owner_id=$1 AND id=$2 FOR UPDATE',[owner,id])).rows[0];if(!row)throw new PlatformError(404,'CHAT_TURN_NOT_FOUND','没有可访问的聊天记录。');
   const previous=decode(owner,row,id);if(previous.state!=='pending')return previous;
   const turn=nextChatTurn(previous,expectedRevision,change);
   const result=await client.query("UPDATE lifeos_platform.platform_chat_turn SET assistant_text=$3,state=$4,revision=$5,updated_at=$6,error_code=$7 WHERE owner_id=$1 AND id=$2 AND revision=$8 AND state='pending'",[owner,id,turn.assistantText,turn.state,turn.revision,turn.updatedAt,turn.errorCode,expectedRevision]);
   if(result.rowCount!==1)throw new PlatformError(409,'CHAT_REVISION_CONFLICT','聊天状态已变化，请重新读取。');return turn;
  });
 }
}
