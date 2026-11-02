import type {RecordEntry} from '../records-candidate/contracts.ts';
type Channel='list'|'detail'|'history'|'readback'|'recovery'|'candidates'|'linkedSources'|'recap'|'source';
/** Selection/auth changes invalidate every affected request, including post-save readback. */
export function createRecordsReadFence(){
 const versions:Record<Channel,number>={list:0,detail:0,history:0,readback:0,recovery:0,candidates:0,linkedSources:0,recap:0,source:0};let disposed=false;
 return {begin(channel:Channel){const version=++versions[channel];return()=>!disposed&&version===versions[channel];},invalidate(...channels:Channel[]){for(const channel of channels.length?channels:['list','detail','history','readback','recovery','candidates','linkedSources','recap','source']as const)versions[channel]++;},dispose(){disposed=true;}};
}

function canonical(value:unknown):string{
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 const object=value as Record<string,unknown>;return '{'+Object.keys(object).sort().map(key=>JSON.stringify(key)+':'+canonical(object[key])).join(',')+'}';
}
function comparableDraft(draft:RecordEntry['draft']){return draft.record.type==='project'&&draft.record.links===undefined?{...draft,record:{...draft.record,links:[]}}:draft;}
/** A newer draft may differ; the saved revision and immutable source may not. */
export function assertRecordReadback(receipt:RecordEntry,current:RecordEntry):void{
 if(current.id!==receipt.id||current.kind!==receipt.kind||current.draft.record.type!==receipt.draft.record.type||current.revision<receipt.revision||current.createdAt!==receipt.createdAt||canonical(current.source)!==canonical(receipt.source)||(current.revision===receipt.revision&&canonical(comparableDraft(current.draft))!==canonical(comparableDraft(receipt.draft))))throw Error('回读与保存回执不一致，请重新读取。');
}
