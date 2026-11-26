import type {SqlClient} from '../platform/postgres.ts';
import {personalEntryType} from '../personal-candidate/service.ts';
import {memoTopicNames} from './memo-topics.ts';
import {readRecentMemoRow,recentMemosLimit,type RecentMemo,type RecentMemos} from './recent-memos.ts';
import type {StoredEntry} from '../platform/contracts.ts';

const from=(r:string,s:string)=>`lifeos_platform.platform_record ${r}
 JOIN lifeos_platform.platform_source ${s} ON ${s}.owner_id=${r}.owner_id AND ${s}.id=${r}.source_id`;
const native=(r:string,s:string,type:string)=>`${r}.kind='inbox' AND ${s}.system='website' AND ${s}.version=1
 AND ${s}.external_id=${r}.id::text AND ${s}.original->>'marker'='personal-manual-v1'
 AND ${s}.original->>'type'='${type}' AND ${s}.original->>'spaceId'=$2
 AND ${s}.original#>>'{input,spaceId}'=$2 AND ${s}.original#>'{input,confirmed}'='true'::jsonb
 AND ${r}.draft->>'disposition'='reference'`;
const topicPins=`CASE WHEN jsonb_typeof(r.draft#>'{personal,links,topics}')='array'
 THEN r.draft#>'{personal,links,topics}' ELSE '[]'::jsonb END`;
// #164 used ISO millisecond timestamps. Keep the emitted time, sort, and
// pagination cutoff in the same bucket before applying the ID tiebreak.
const recordedTime="date_trunc('milliseconds',r.created_at,'UTC')";
const timestamp=`to_char(${recordedTime} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const topicMatch=`$3 AND tr.owner_id=r.owner_id AND ${native('tr','ts','topic')}
 AND tr.draft#>>'{personal,type}'='topic'
 AND tr.id=CASE WHEN (pin->>'id') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   THEN (pin->>'id')::uuid END
 AND ts.id::text=lower(pin->>'sourceId') AND to_jsonb(tr.revision)=pin->'revision'`;
const memoMatches=`FROM jsonb_array_elements(${topicPins}) pin
 JOIN (${from('tr','ts')}) ON ${topicMatch} WHERE tr.draft->>'title'=ANY($4::text[])`;
const entry=(r:string,s:string)=>`jsonb_build_object('id',${r}.id,'kind',${r}.kind,'revision',${r}.revision,
 'draft',${r}.draft,'syncState','draft','externalStatus',null,
 'source',jsonb_build_object('id',${s}.id,'system',${s}.system,'externalId',${s}.external_id,'version',${s}.version,'original',${s}.original))`;

export async function queryRecentMemos(client:SqlClient,owner:string,space:string,canReadTopics:boolean):Promise<RecentMemos>{
 const rows:RecentMemo[]=[];
 let cursor:{recordedAt:string;id:string}|null=null;
 // SQL narrows the candidates before returning bodies. The existing stored-record
 // validator still rejects invalid sources, and the cursor keeps seeking past them.
 const query=async(mode:'memo'|'unknown',limit:number)=>{
  const selected=mode==='memo'?`EXISTS (SELECT 1 ${memoMatches})`:
   `EXISTS (SELECT 1 FROM jsonb_array_elements(${topicPins}) pin WHERE NOT EXISTS
    (SELECT 1 FROM ${from('tr','ts')} WHERE ${topicMatch}))`;
  const topics=mode==='memo'?`(SELECT jsonb_agg(${entry('tr','ts')}) ${memoMatches})`:'NULL';
  const result=await client.query(`SELECT r.id::text,${timestamp} AS "recordedAt", ${entry('r','s')} AS journal, ${topics} AS topics
   FROM ${from('r','s')}
   WHERE r.owner_id=$1 AND ${native('r','s','journal')} AND ${selected}
   AND ($5::timestamptz IS NULL OR (${recordedTime},r.id)<($5::timestamptz,$6::uuid))
   AND $4::text[] IS NOT NULL ORDER BY ${recordedTime} DESC,r.id DESC LIMIT $7`,
   [owner,space,canReadTopics,[...memoTopicNames],cursor?.recordedAt??null,cursor?.id??null,limit]);
  return result.rows as {id:string;recordedAt:string;journal:StoredEntry;topics:StoredEntry[]|null}[];
 };
 let invalidTopic=false;
 if(canReadTopics)while(rows.length<recentMemosLimit){
  const limit=recentMemosLimit-rows.length;
  const selected=await query('memo',limit);
  for(const row of selected)if(personalEntryType(row.journal,space)==='journal'){
   if(row.topics?.some(topic=>personalEntryType(topic,space)==='topic')){
    const fields=row.journal.draft as {title:string;text:string;occurredOn:string|null};
    rows.push(readRecentMemoRow({id:row.id,recordedAt:row.recordedAt,...fields}));
   }else invalidTopic=true;
  }
  if(selected.length<limit)break;
  cursor=selected.at(-1)!;
 }
 // The status is shown only for an empty preview. Stop at the first
 // valid unresolved journal instead of fetching or counting the whole journal.
 if(rows.length||invalidTopic)return {rows,classificationPending:!rows.length};
 cursor=null;
 for(;;){
  const selected=await query('unknown',recentMemosLimit);
  if(selected.some(row=>personalEntryType(row.journal,space)==='journal'))return {rows,classificationPending:true};
  if(selected.length<recentMemosLimit)return {rows,classificationPending:false};
  cursor=selected.at(-1)!;
 }
}
