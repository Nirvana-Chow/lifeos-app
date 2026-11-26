import {validateId,validateInbox} from '../platform/domain.ts';

export const recentMemosPath='/api/platform/personal/journal/recent-memos';
export const recentMemosLimit=5;
export type RecentMemo={id:string;title:string;text:string;occurredOn:string|null;recordedAt:string};
export type RecentMemos={rows:RecentMemo[];classificationPending:boolean};
export type RecentMemosReader={readRecentMemos(owner:string,space:string,canReadTopics:boolean):Promise<RecentMemos>};

export function readRecentMemoRow(value:unknown):RecentMemo{
 if(!value||typeof value!=='object')throw Error('Invalid recent memo');
 const {id,title,text,occurredOn,recordedAt}=value as Record<string,unknown>;
 if(typeof recordedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(recordedAt)||
    !Number.isFinite(Date.parse(recordedAt)))throw Error('Invalid recorded time');
 const fields=validateInbox({title,text,occurredOn,disposition:'reference'});
 if(!fields.text.trim())throw Error('Invalid memo text');
 return {id:validateId(id),title:fields.title,text:fields.text,occurredOn:fields.occurredOn,recordedAt};
}

export async function loadRecentMemos(fetcher:typeof fetch,expectedScope:string){
 const response=await fetcher(recentMemosPath,{credentials:'same-origin',cache:'no-store'});
 if(!response.ok)throw Error('Recent memos unavailable');
 const value=await response.json();
 if(value.scope!=='recent-memos-v1'||JSON.stringify([value.ownerId,value.spaceId])!==expectedScope||
    typeof value.classificationPending!=='boolean'||!Array.isArray(value.rows)||value.rows.length>recentMemosLimit)throw Error('Invalid recent memos');
 const rows:RecentMemo[]=value.rows.map(readRecentMemoRow);
 if(new Set(rows.map(row=>row.id)).size!==rows.length)throw Error('Duplicate recent memo');
 return {rows:rows.map(row=>({...row,href:'/personal/journal?record='+row.id})),classificationPending:value.classificationPending as boolean};
}
