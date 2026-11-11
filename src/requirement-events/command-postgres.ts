import type {SqlClient} from '../platform/postgres.ts';
import type {ExecutionCommandBinding} from './admission.ts';
/** All claim/renew/admit actions share this exact durable key namespace. */
export async function readExecutionCommand(client:SqlClient,owner:string,b:ExecutionCommandBinding){
 await client.query("SELECT set_config('lifeos.requirement_event_space',$1,true)",[b.spaceId]);
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['requirement-claim-v1',owner,b.spaceId,b.grantId,b.key])]);
 const row=(await client.query('SELECT digest,response FROM lifeos_platform.requirement_claim_command WHERE owner_id=$1 AND space_id=$2 AND grant_id=$3 AND command_key=$4',[owner,b.spaceId,b.grantId,b.key])).rows[0];
 return row?{digest:String(row.digest),response:row.response}:null;
}
export async function saveExecutionCommand(client:SqlClient,owner:string,b:ExecutionCommandBinding,digest:string,response:unknown){
 await client.query('INSERT INTO lifeos_platform.requirement_claim_command(owner_id,space_id,grant_id,command_key,digest,response) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[owner,b.spaceId,b.grantId,b.key,digest,JSON.stringify(response)]);
}
