import type {PublicEntry} from '../platform/contracts.ts';
import {object,validateId,validateRevision} from '../platform/domain.ts';
import {normalizeMediaPersonalFields,mediaStates,type MediaPersonal,type MediaPersonalFields,type MediaState,type MediaKind} from './domain.ts';

export type MediaEntry={id:string;revision:number;fields:MediaPersonalFields};
export type MediaRow=MediaEntry&{sourceId:string;title:string;summary:string[];entry:PublicEntry};
export const mediaKindLabels:Record<MediaKind,string>={book:'书籍',film:'电影',series:'剧集'};
export const mediaStateLabels:Record<MediaState,string>={wish:'想读 / 想看',in_progress:'进行中',completed:'已完成',paused:'已暂停'};
export const mediaUnitLabels={page:'页',episode:'集',percent:'%'} as const;
export function mediaProgressLabel(personal:MediaPersonal):string|null{const p=personal.progress;if(p.unit===null)return null;const unit=mediaUnitLabels[p.unit];if(p.current===null)return p.total===null?null:`总量 ${p.total} ${unit}，进度未知`;return `${p.current}${p.total===null?'':` / ${p.total}`} ${unit}`;}
/** Adapted from Jelu BookCard.vue showProgressBar, MIT; full source pin/license in third-party/personal-media. */
export function mediaProgressPercent(personal:MediaPersonal):number|null{const p=personal.progress;if(personal.state!=='in_progress'||p.current===null)return null;if(p.unit==='percent')return p.current;return p.total===null?null:p.current/p.total*100;}
export function mediaSummary(personal:MediaPersonal):string[]{return[mediaKindLabels[personal.mediaKind],mediaStateLabels[personal.state],personal.creators.length?personal.creators.join(' / '):null,mediaProgressLabel(personal),personal.rating===null?null:`个人评分 ${personal.rating} / 10`].filter((value):value is string=>value!==null);}
export function projectMediaBoard(records:readonly MediaEntry[],filter:{kind?:MediaKind|'all';search?:string}={}){
 const query=filter.search?.trim().toLocaleLowerCase()??'',buckets:Record<MediaState,MediaEntry[]>={wish:[],in_progress:[],completed:[],paused:[]};
 for(const record of records){const p=record.fields.personal;if(filter.kind&&filter.kind!=='all'&&p.mediaKind!==filter.kind)continue;if(query&&![record.fields.title,record.fields.text,...p.creators,p.isbn,p.external.id].filter(Boolean).join('\n').toLocaleLowerCase().includes(query))continue;buckets[p.state].push(record);}
 return{columns:mediaStates.map(state=>({state,label:mediaStateLabels[state],records:buckets[state]})),total:mediaStates.reduce((count,state)=>count+buckets[state].length,0),completed:buckets.completed.length,inProgress:buckets.in_progress.length};
}
/** Projects an already owner-scoped PersonalService response. It does not authorize access. */
export function projectMediaEntries(entries:readonly PublicEntry[],spaceId:string,search=''):MediaRow[]{
 const query=search.trim().toLocaleLowerCase(),rows:MediaRow[]=[];
 for(const entry of entries){try{const source=entry.source,original=object(source.original,['marker','spaceId','type','input']),initial=object(original.input,['spaceId','confirmed','fields']);
  if(original.marker!=='personal-manual-v1'||original.type!=='media'||original.spaceId!==spaceId||initial.spaceId!==spaceId||initial.confirmed!==true||source.system!=='website'||source.externalId!==entry.id||source.version!==1||entry.kind!=='inbox'||entry.syncState!=='draft'||entry.externalStatus!==null)continue;
  normalizeMediaPersonalFields(initial.fields);const draft=object(entry.draft,['title','text','occurredOn','personal','disposition']);if(draft.disposition!=='reference')continue;const fields=normalizeMediaPersonalFields({title:draft.title,text:draft.text,occurredOn:draft.occurredOn,personal:draft.personal});
  if(query&&!projectMediaBoard([{id:entry.id,revision:entry.revision,fields}],{search:query}).total)continue;
  rows.push({id:validateId(entry.id),sourceId:validateId(source.id),revision:validateRevision(entry.revision),title:fields.title,fields,summary:mediaSummary(fields.personal),entry});
 }catch{/* Malformed entries never become inferred reading/watching history. */}}
 return rows;
}
export const buildMediaBoard=projectMediaBoard;
