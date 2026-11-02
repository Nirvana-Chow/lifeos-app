import {assertReadableEntries} from '../platform/data-compatibility.ts';
import {PlatformError,validateId,validateRevision} from '../platform/domain.ts';
import {validateCalendarDate,validateCalendarSchedule} from '../calendar-candidate/domain.ts';
import type {DraftService} from '../platform/service.ts';
import type {PublicEntry,Kind} from '../platform/contracts.ts';
import type {CalendarService} from '../calendar-candidate/service.ts';
import type {PublicCalendarEntry} from '../calendar-candidate/contracts.ts';
import {normalizeProjectLinks,validateRecordMetadata} from '../records-candidate/domain.ts';
import type {SearchQuery,SearchKind,SearchDocument,SearchHit,SearchResponse,SourceResponse} from './contracts.ts';
const SCAN_LIMIT=2000,HISTORY_LIMIT=20;
const kinds=['todo','finance','inbox','calendar'] as const;
const bad=():never=>{throw new PlatformError(400,'INVALID_SEARCH_QUERY','请核对关键词、类型、日期范围和结果上限。');};
const unavailable=():never=>{throw new PlatformError(503,'SEARCH_UNAVAILABLE','搜索内容暂时无法核对，请稍后重试。');};
const missing=():never=>{throw new PlatformError(404,'NOT_FOUND','没有可访问的来源。');};
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const normalized=(v:string)=>v.normalize('NFKC').toLowerCase();
export function parseSearchQuery(params:URLSearchParams):SearchQuery{
 const known=['q','from','to','type','includeSynthetic','limit'],seen=new Set<string>();
 for(const[key]of params){if(!known.includes(key)||seen.has(key))bad();seen.add(key);}
 const q=(params.get('q')??'').trim(),type=params.get('type')||undefined,from=params.get('from')||undefined,to=params.get('to')||undefined,include=params.get('includeSynthetic');
 if(q.length>200||/[\u0000-\u001f\u007f]/.test(q)||q.split(/\s+/).length>8||type&&!/^[a-z][a-z0-9-]{0,31}$/.test(type)||include!==null&&include!=='true'&&include!=='false')bad();
 if(from)validateCalendarDate(from);if(to)validateCalendarDate(to);if(from&&to&&from>to)bad();
 const raw=params.get('limit');if(raw!==null&&!/^[1-9]\d{0,2}$/.test(raw))bad();const limit=raw===null?30:Number(raw);if(limit>100)bad();
 return{q,...(from?{from}:{}),...(to?{to}:{}),...(type?{type}:{}),includeSynthetic:include==='true',limit};
}
export function validateSearchKind(kind:string):SearchKind{if(!kinds.includes(kind as SearchKind))bad();return kind as SearchKind;}
function safeText(value:unknown,max=16384):string{
 if(value===undefined||value===null)return'';if(typeof value!=='string'||value.length>max||value.includes('\0'))return unavailable();return value;
}
function date(value:unknown):string|null{if(value===undefined||value===null||value==='')return null;try{return validateCalendarDate(value);}catch{return unavailable();}}
function scalar(value:unknown):string{if(value===null||value===undefined)return'未知';if(typeof value==='string')return safeText(value);if(typeof value==='number'&&Number.isFinite(value))return String(value);if(typeof value==='boolean')return value?'是':'否';return unavailable();}
function validURL(value:unknown):string{
 const raw=safeText(value,2048);if(!raw)return'未知';try{const url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return'引用地址未通过安全校验';return raw;}catch{return'引用地址未通过安全校验';}
}
function calendarDay(value:unknown):string|null{
 const raw=obj(value);if(!raw.kind)return null;
 try{const schedule=validateCalendarSchedule(raw);if(schedule.kind==='all-day')return schedule.startDate;
  if(/^[+-]\d{2}:\d{2}$/.test(schedule.timeZone)){const sign=schedule.timeZone[0]==='-'?-1:1,offset=(Number(schedule.timeZone.slice(1,3))*60+Number(schedule.timeZone.slice(4,6)))*sign;return new Date(Date.parse(schedule.startAt)+offset*60000).toISOString().slice(0,10);}
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:schedule.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(schedule.startAt));const part=(type:string)=>parts.find(p=>p.type===type)!.value;return part('year').padStart(4,'0')+'-'+part('month')+'-'+part('day');
 }catch{return unavailable();}
}
export type SearchCandidate={kind:SearchKind;entry:PublicEntry|PublicCalendarEntry};
type Candidate=SearchCandidate;
function payload(candidate:Candidate,original=false):Record<string,unknown>{
 const raw=obj(original?candidate.entry.source.original:candidate.kind==='calendar'?candidate.entry:(candidate.entry as PublicEntry).draft);
 if(original&&raw.acceptedFields){const accepted=obj(raw.acceptedFields);return{title:accepted.title,[candidate.kind==='todo'?'notes':'text']:accepted.body,occurredOn:accepted.date,dueOn:accepted.date,inputText:raw.inputText};}
 return raw;
}
function typeOf(candidate:Candidate):string{
 const raw=payload(candidate),record=obj(raw.record);if(typeof record.type==='string'&&/^[a-z][a-z0-9-]{0,31}$/.test(record.type))return record.type;
 if(candidate.kind==='inbox'&&obj(obj(candidate.entry.source.original).capture).kind==='life')return'journal';return candidate.kind;
}
function dayOf(candidate:Candidate,original=false):string|null{const raw=payload(candidate,original);return candidate.kind==='calendar'?calendarDay(raw.schedule):date(candidate.kind==='todo'?raw.dueOn:raw.occurredOn);}
/** Business-field projection only: never serialize repository objects, raw history
 * commands, owner IDs, protected configuration, or arbitrary source attributes. */
function document(candidate:Candidate,original=false):SearchDocument{
 if(candidate.kind!=='calendar')assertReadableEntries([candidate.entry]);
 const {entry,kind}=candidate,raw=payload(candidate,original),record=obj(raw.record),fields:SearchDocument['fields']=[];
 const add=(key:string,label:string,values=raw)=>{if(Object.hasOwn(values,key))fields.push({label,value:scalar(values[key])});};
 let id:string,sourceId:string,revision:number;try{id=validateId(entry.id);sourceId=validateId(entry.source.id);revision=validateRevision(original?entry.source.version:entry.revision);}catch{return unavailable();}
 if(entry.source.system!=='website'||entry.source.externalId!==entry.id)return unavailable();
 const title=safeText(raw.title,240)||(kind==='finance'?'财务草稿':'原始输入'),sourceSystem=entry.source.system,type=typeOf(candidate),day=dayOf(candidate,original);
 add('title','标题');add('inputText','原始输入全文');add('text','正文');add('notes','备注');add('status','状态');add('disposition','处理方式');
 if(kind==='finance'){add('kind','流水类型');add('amountMinor','金额（分）');add('currency','币种');add('category','分类');add('fromAccountRef','转出账户引用');add('toAccountRef','转入账户引用');add('originalEntryId','关联原流水 ID');}
 const metadataLabels:Record<string,string>={type:'记录类型',topic:'学习主题',status:'学习状态',nextStep:'下一步',evidence:'经历证据',label:'本人情绪描述',intensity:'本人选择的强度',author:'作者',attribution:'内容归属',stage:'项目阶段',exercise:'实际动作'};
 for(const[key,label]of Object.entries(metadataLabels))add(key,label,record);
 for(const[key,label]of Object.entries({resourceURL:'资料链接',sourceURL:'原文链接',url:'资料链接'}))if(Object.hasOwn(record,key))fields.push({label,value:validURL(record[key])});
 if(record.type==='training'){try{validateRecordMetadata(record);}catch{return unavailable();}if(!Array.isArray(record.sets))return unavailable();for(const [index,row] of record.sets.entries()){const v=obj(row),w=obj(v.weight),d=obj(v.duration);fields.push({label:'实际第 '+(index+1)+' 组',value:'次数：'+(v.reps??'未知')+'；重量：'+(w.value===undefined?'未知':String(w.value)+' '+w.unit)+'；时长：'+(d.value===undefined?'未知':String(d.value)+' '+d.unit)});}}
 if(record.type==='project'){let links;try{links=normalizeProjectLinks(record.links);}catch{return unavailable();}for(const link of links){fields.push({label:'关联记录（'+link.type+'）',value:'记录 ID：'+link.id+'\n来源 ID：'+link.sourceId+'\n确认修订：'+String(link.revision)});}}
 for(const[key,label]of Object.entries({completion:'完成自报',testing:'手动测试记录',review:'评审记录'})){const value=obj(record[key]);for(const[sub,sublabel]of Object.entries({selfReported:'本人自报',manuallyRecorded:'手动记录',status:'状态',outcome:'结果',decision:'结论',evidence:'证据'}))add(sub,label+' · '+sublabel,value);}
 if(kind==='calendar'){const schedule=obj(raw.schedule);for(const[key,label]of Object.entries({kind:'日程类型',startDate:'开始日期',endDate:'结束日期（不含）',startAt:'开始时刻',endAt:'结束时刻',timeZone:'日程时区'}))add(key,label,schedule);if(original&&!Object.hasOwn(raw,'status'))fields.push({label:'创建时状态',value:'planned'});}
 fields.push({label:'来源记录 ID',value:safeText(entry.source.externalId,36)},{label:'来源捕获时间',value:safeText(entry.source.asOf,40)},{label:'版本更新时间',value:safeText(original?entry.source.asOf:entry.updatedAt,40)});
 return{id,kind,type,title,date:day,sourceId,sourceSystem,snippet:'',revision,fields};
}
export {document as projectSearchDocument};
function searchable(value:SearchDocument):string{return[value.id,value.sourceId,value.sourceSystem,value.kind,value.type,value.title,value.date??'',...value.fields.map(f=>f.value)].join('\n');}
function hit(value:SearchDocument,terms:string[]):SearchHit{
 const content=value.fields.filter(f=>['正文','备注','原始输入全文','经历证据'].includes(f.label)).map(f=>f.value).join(' ')||value.title;
 const flat=content.replace(/\s+/g,' '),index=terms.length?Math.max(0,normalized(flat).indexOf(terms[0])):0,start=Math.max(0,index-45),snippet=(start?'…':'')+flat.slice(start,start+220)+(start+220<flat.length?'…':'');
 const{fields,...base}=value;void fields;return{...base,snippet};
}
/** Exact existing deterministic current+original business-field matching, within one bounded source window. */
export function projectWindowSearchHit(candidate:SearchCandidate,query:SearchQuery):SearchHit|null{
 const current=document(candidate),original=document(candidate,true);if(query.type&&query.type!==current.type&&query.type!==current.kind||query.from&&(!current.date||current.date<query.from)||query.to&&(!current.date||current.date>query.to))return null;
 const terms=normalized(query.q).split(/\s+/).filter(Boolean),text=normalized(searchable(current)+'\n'+searchable(original));return terms.every(term=>text.includes(term))?hit(current,terms):null;
}
export class SearchService{
 private drafts:DraftService;private calendar?:CalendarService;
 constructor(drafts:DraftService,calendar?:CalendarService){this.drafts=drafts;this.calendar=calendar;}
 async search(owner:string,input:SearchQuery):Promise<SearchResponse>{
  const query=parseSearchQuery(new URLSearchParams(Object.entries(input).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]))),limit=query.limit!;
  const empty:SearchResponse={items:[],limit,truncated:false,scanned:0,dataStatus:'isolated-test-drafts',syntheticIncluded:query.includeSynthetic,coverage:{scanLimit:SCAN_LIMIT,scanTruncated:false,calendarAvailable:!!this.calendar}};
  if(!query.includeSynthetic)return empty;
  const snapshot=await this.drafts.exportSnapshot(owner);assertReadableEntries([...snapshot.entries,...snapshot.history]);
  const batches=[snapshot.entries.map(entry=>({kind:entry.kind,entry}as Candidate))];
  if(this.calendar)batches.push((await this.calendar.exportSnapshot(owner)).entries.map(entry=>({kind:'calendar',entry}as Candidate)));
  // Existing ports return full owner lists. Restrict date/type before the stable
  // scan cap; report partial coverage explicitly, never call this a total count.
  const candidates=batches.flat().filter(candidate=>{if(query.type&&query.type!==candidate.kind&&query.type!==typeOf(candidate))return false;const date=dayOf(candidate);return(!query.from||date!==null&&date>=query.from)&&(!query.to||date!==null&&date<=query.to);});
  candidates.sort((a,b)=>compare(dayOf(b)??'',dayOf(a)??'')||compare(a.kind,b.kind)||compare(a.entry.id,b.entry.id));
  const terms=normalized(query.q).split(/\s+/).filter(Boolean),selected=candidates.slice(0,SCAN_LIMIT),matches:SearchHit[]=[];
  for(const candidate of selected){const current=document(candidate),original=document(candidate,true),text=normalized(searchable(current)+'\n'+searchable(original));if(terms.every(term=>text.includes(term)))matches.push(hit(current,terms));}
  return{...empty,items:matches.slice(0,limit),scanned:selected.length,truncated:candidates.length>SCAN_LIMIT||matches.length>limit,coverage:{...empty.coverage,scanTruncated:candidates.length>SCAN_LIMIT}};
 }
 async source(owner:string,inputKind:string,inputId:string,includeSynthetic=false):Promise<SourceResponse>{
  const kind=validateSearchKind(inputKind),id=validateId(inputId);if(!includeSynthetic)return missing();
  let candidate:Candidate,history:Candidate[];
  if(kind==='calendar'){if(!this.calendar)throw new PlatformError(503,'CALENDAR_UNAVAILABLE','日历来源尚未启用。');const entry=await this.calendar.get(owner,id);candidate={kind,entry};history=(await this.calendar.history(owner,id)).map(row=>({kind,entry:row.entry}));}
  else{const entry=await this.drafts.get(owner,kind as Kind,id);candidate={kind,entry};history=(await this.drafts.history(owner,kind as Kind,id)).map(entry=>({kind,entry}));}
  const source=candidate.entry.source;history=history.filter(row=>row.entry.id===id&&row.entry.source.id===source.id&&row.entry.revision<=candidate.entry.revision);
  history.sort((a,b)=>b.entry.revision-a.entry.revision);const seen=new Set<number>();history=history.filter(row=>{if(seen.has(row.entry.revision))return false;seen.add(row.entry.revision);return true;});
  return{current:document(candidate),original:document(candidate,true),history:history.slice(0,HISTORY_LIMIT).map(row=>document(row)),historyLimit:HISTORY_LIMIT,historyTruncated:history.length>HISTORY_LIMIT,dataStatus:'isolated-test-drafts',syntheticIncluded:true};
 }
}
