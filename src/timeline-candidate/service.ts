import {assertReadableEntries} from '../platform/data-compatibility.ts';
import {PlatformError,validateId} from '../platform/domain.ts';
import type {DraftService} from '../platform/service.ts';
import type {PublicEntry,SourceEvidence} from '../platform/contracts.ts';
import type {CalendarService} from '../calendar-candidate/service.ts';
import type {PublicCalendarEntry} from '../calendar-candidate/contracts.ts';
import {validateCalendarSchedule} from '../calendar-candidate/domain.ts';
import {projectSearchDocument,type SearchCandidate} from '../search-candidate/service.ts';
import type {SearchDocument} from '../search-candidate/contracts.ts';
import {parseTimelineQuery,parseTimelineComparisonQuery,timelineLocalDate,timelineCalendarDays} from './domain.ts';
import type {TimelineItem,TimelineQuery,TimelineResponse,TimelineComparisonQuery,TimelineComparisonPeriod,TimelineComparisonResponse} from './contracts.ts';
const SCAN_LIMIT=2000;
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const unavailable=():never=>{throw new PlatformError(503,'TIMELINE_UNAVAILABLE','时间线暂时无法核对，请稍后重试。');};
const identity=(candidate:SearchCandidate)=>candidate.kind+':'+candidate.entry.id;
// Compare JSON values by content, not object insertion order. Source originals
// remain untouched and never leave this service as arbitrary metadata.
function same(a:unknown,b:unknown):boolean{
 if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const left=a as Record<string,unknown>,right=b as Record<string,unknown>,keys=Object.keys(left);
 return keys.length===Object.keys(right).length&&keys.every(key=>Object.hasOwn(right,key)&&same(left[key],right[key]));
}
function sameSource(a:SourceEvidence,b:SourceEvidence):boolean{
 return a.id===b.id&&a.system===b.system&&a.externalId===b.externalId&&a.version===b.version&&a.asOf===b.asOf&&same(a.original,b.original);
}
function instant(at:string,timeZone:string,sourceTimeZone:string):Pick<TimelineItem,'date'|'at'|'dateKind'|'sourceTimeZone'>{
 return{date:timelineLocalDate(at,timeZone),at,dateKind:'instant',sourceTimeZone};
}
function occurrence(candidate:SearchCandidate,document:SearchDocument,zone:string):Pick<TimelineItem,'date'|'at'|'dateKind'|'timeRole'|'sourceTimeZone'>{
 const timeRole=candidate.kind==='calendar'?'scheduled':candidate.kind==='todo'?'due':'occurred';
 if(candidate.kind==='calendar'){
  const schedule=validateCalendarSchedule((candidate.entry as PublicCalendarEntry).schedule);
  // A calendar event contributes only its start anchor. Its interval and status
  // never establish that an activity occurred or a duration was spent.
  if(schedule.kind==='timed')return{...instant(schedule.startAt,zone,schedule.timeZone),timeRole};
  return{date:schedule.startDate,at:null,dateKind:'date',timeRole,sourceTimeZone:null};
 }
 return{date:document.date,at:null,dateKind:document.date===null?'unknown':'date',timeRole,sourceTimeZone:null};
}
function status(candidate:SearchCandidate):string|null{
 if(candidate.kind==='calendar'){
  const value=(candidate.entry as PublicCalendarEntry).status;if(value!=='planned'&&value!=='cancelled')return unavailable();return value;
 }
 if(candidate.kind==='todo'){
  const value=(candidate.entry as PublicEntry).draft;if(!('status'in value)||!['open','in_progress','done','cancelled'].includes(value.status))return unavailable();return value.status;
 }
 return null;
}
function event(candidate:SearchCandidate,current:SearchCandidate,query:TimelineQuery,document=projectSearchDocument(candidate)):TimelineItem{
 const {axis,timeZone}=query,entry=candidate.entry;
 const when=axis==='occurred'?occurrence(candidate,document,timeZone):{...instant(axis==='recorded'?entry.createdAt:entry.updatedAt,timeZone,'UTC'),timeRole:axis};
 const summary=(document.fields.filter(field=>['正文','备注','经历证据'].includes(field.label)).map(field=>field.value).join(' ')||document.title).replace(/\s+/g,' ').slice(0,500);
 return{eventKey:axis+':'+identity(candidate)+(axis==='changed'?':'+entry.revision:''),id:document.id,kind:document.kind,type:document.type,sourceId:document.sourceId,revision:document.revision,currentRevision:current.entry.revision,title:document.title,summary,...when,status:status(candidate),isHistorical:entry.revision<current.entry.revision};
}
const matchesType=(document:SearchDocument,type?:string)=>!type||document.type===type||document.kind===type;
function sortEvents(a:TimelineItem,b:TimelineItem):number{
 return compare(b.date??'',a.date??'')||compare(b.at??'',a.at??'')||compare(a.kind,b.kind)||compare(a.id,b.id)||b.revision-a.revision;
}
/** Existing owner-filtered snapshots only. Core records/history share one read
 * snapshot; optional calendar data is a separate adapter snapshot, not a global
 * atomic observation. Output caps do not imply DB pagination or live freshness. */
/** Single bounded-row projection. Scan order is recording/history order, not global occurred-date order. */
export function projectWindowTimelineEvent(candidate:SearchCandidate,currentRevision:number,query:TimelineQuery):TimelineItem|null{
 const doc=projectSearchDocument(candidate);if(!matchesType(doc,query.type)||query.axis==='changed'&&candidate.entry.revision<=1)return null;
 const current={...candidate,entry:{...candidate.entry,revision:currentRevision}} as SearchCandidate,displayCandidate=query.axis==='occurred'?candidate:{...candidate,entry:{...candidate.entry,createdAt:new Date(candidate.entry.createdAt).toISOString(),updatedAt:new Date(candidate.entry.updatedAt).toISOString()}} as SearchCandidate,item=event(displayCandidate,current,query,doc);
 if(query.from&&(!item.date||item.date<query.from)||query.to&&(!item.date||item.date>query.to))return null;return item;
}
export class TimelineService{
 private drafts:DraftService;private calendar?:CalendarService;private now:()=>Date;
 constructor(drafts:DraftService,calendar?:CalendarService,now:()=>Date=()=>new Date()){this.drafts=drafts;this.calendar=calendar;this.now=now;}
 async compare(owner:string,input:TimelineComparisonQuery):Promise<TimelineComparisonResponse>{
  const query=parseTimelineComparisonQuery(new URLSearchParams(Object.entries(input).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)])));
  const result:TimelineComparisonResponse={query,observedAt:this.now().toISOString(),dataStatus:'isolated-test-drafts',syntheticIncluded:query.includeSynthetic,comparison:null,coverage:{currentRecords:null,calendarAvailable:!!this.calendar,snapshotConsistency:this.calendar?'per-adapter-snapshots':'owner-snapshot',summaryScope:'all-current-snapshot-records',meaning:'existing-record-coverage-only'}};
  if(!query.includeSynthetic)return result;
  try{
   // Both periods share these exact reads. The existing adapter exports fetch
   // complete snapshots (including history); this is not bounded DB pagination.
   const core=await this.drafts.exportSnapshot(owner);assertReadableEntries([...core.entries,...core.history]);const calendar=this.calendar?await this.calendar.exportSnapshot(owner):null;
   const candidates:SearchCandidate[]=[...core.entries.map(entry=>({kind:entry.kind,entry})),...(calendar?.entries.map(entry=>({kind:'calendar' as const,entry}))??[])];
   const current=new Map<string,SearchCandidate>();
   for(const candidate of candidates){
    const key=candidate.kind+':'+validateId(candidate.entry.id),prior=current.get(key);
    // Detect contradictory current rows before applying a subtype filter.
    if(prior&&!same(prior.entry,candidate.entry))return unavailable();
    current.set(key,candidate);
   }
   const events:TimelineItem[]=[],recordedQuery:TimelineQuery={axis:'recorded',timeZone:query.timeZone,type:query.type,includeSynthetic:true,limit:query.limit};
   for(const candidate of current.values()){
    const document=projectSearchDocument(candidate);if(matchesType(document,query.type))events.push(event(candidate,candidate,recordedQuery,document));
   }
   events.sort(sortEvents);result.coverage.currentRecords=events.length;
   const period=(from:string,to:string):TimelineComparisonPeriod=>{
    const matches=events.filter(item=>item.date!==null&&item.date>=from&&item.date<=to),recordedDays=new Set(matches.map(item=>item.date)).size,calendarDays=timelineCalendarDays(from,to);
    return{from,to,calendarDays,recordCount:matches.length,recordedDays,recordedDayRatio:recordedDays/calendarDays,items:matches.slice(0,query.limit),itemsTruncated:matches.length>query.limit};
   };
   const from=query.aFrom>query.bFrom?query.aFrom:query.bFrom,to=query.aTo<query.bTo?query.aTo:query.bTo,overlaps=from<=to;
   // Statistics use every accepted current record; only the displayed sources
   // are capped. History/revisions never add records or move the recording date.
   result.comparison={a:period(query.aFrom,query.aTo),b:period(query.bFrom,query.bTo),overlap:{from:overlaps?from:null,to:overlaps?to:null,calendarDays:overlaps?timelineCalendarDays(from,to):0,recordCount:overlaps?events.filter(item=>item.date!==null&&item.date>=from&&item.date<=to).length:0}};
   result.observedAt=this.now().toISOString();return result;
  }catch(cause){if(cause instanceof PlatformError&&cause.code==='DATA_READER_INCOMPATIBLE')throw cause;return unavailable();}
 }
 async timeline(owner:string,input:TimelineQuery):Promise<TimelineResponse>{
  const query=parseTimelineQuery(new URLSearchParams(Object.entries(input).filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)])));
  const result:TimelineResponse={items:[],query,limit:query.limit,truncated:false,observedAt:this.now().toISOString(),dataStatus:'isolated-test-drafts',syntheticIncluded:query.includeSynthetic,coverage:{currentRecords:0,firstRecordedAt:null,lastRecordedAt:null,recordedDateCount:0,recordedFrom:null,recordedTo:null,unknownOccurredRecords:0,matchedEvents:0,scannedEvents:0,scanLimit:SCAN_LIMIT,scanTruncated:false,calendarAvailable:!!this.calendar,snapshotConsistency:this.calendar?'per-adapter-snapshots':'owner-snapshot',meaning:'existing-record-coverage-only'}};
  if(!query.includeSynthetic)return result;
  try{
   const core=await this.drafts.exportSnapshot(owner);assertReadableEntries([...core.entries,...core.history]);const calendar=this.calendar?await this.calendar.exportSnapshot(owner):null;
   const candidates:SearchCandidate[]=[...core.entries.map(entry=>({kind:entry.kind,entry})),...(calendar?.entries.map(entry=>({kind:'calendar' as const,entry}))??[])];
   const history:SearchCandidate[]=[...core.history.map(entry=>({kind:entry.kind,entry})),...(calendar?.history.map(row=>({kind:'calendar' as const,entry:row.entry}))??[])];
   const current=new Map<string,{candidate:SearchCandidate;document:SearchDocument}>();
   for(const candidate of candidates){
    const document=projectSearchDocument(candidate),key=identity(candidate);
    if(!matchesType(document,query.type))continue;
    const prior=current.get(key);if(prior&&!same(prior.candidate.entry,candidate.entry))return unavailable();
    current.set(key,{candidate,document});
   }
   const coverage=result.coverage,dates=new Set<string>(),recorded:number[]=[],events:TimelineItem[]=[];
   coverage.currentRecords=current.size;
   for(const{candidate,document}of current.values()){
    dates.add(timelineLocalDate(candidate.entry.createdAt,query.timeZone));recorded.push(Date.parse(candidate.entry.createdAt));
    if(occurrence(candidate,document,query.timeZone).date===null)coverage.unknownOccurredRecords++;
    if(query.axis!=='changed')events.push(event(candidate,candidate,query,document));
   }
   recorded.sort((a,b)=>a-b);const recordingDates=[...dates].sort(compare);
   coverage.firstRecordedAt=recorded.length?new Date(recorded[0]).toISOString():null;coverage.lastRecordedAt=recorded.length?new Date(recorded[recorded.length-1]).toISOString():null;
   coverage.recordedDateCount=dates.size;coverage.recordedFrom=recordingDates[0]??null;coverage.recordedTo=recordingDates[recordingDates.length-1]??null;
   if(query.axis==='changed'){
    const seen=new Map<string,SearchCandidate>();
    for(const candidate of history){
     const latestView=current.get(identity(candidate)),latest=latestView?.candidate,entry=candidate.entry;
     // Initial creation belongs to recorded, not changed. A retained historical
     // row must belong to the current source; deleted or replaced sources vanish.
     if(!latest||!Number.isInteger(entry.revision)||entry.revision<=1||entry.revision>latest.entry.revision||!sameSource(entry.source,latest.entry.source)||entry.createdAt!==latest.entry.createdAt)continue;
     if(entry.revision===latest.entry.revision&&!same(entry,latest.entry))continue;
     const document=projectSearchDocument(candidate);if(document.type!==latestView!.document.type)continue;
     const key=identity(candidate)+':'+entry.revision,prior=seen.get(key);
     if(prior){if(!same(prior.entry,entry))return unavailable();continue;}
     seen.set(key,candidate);
     if(matchesType(document,query.type))events.push(event(candidate,latest,query,document));
    }
   }
   // Cap stable ordered events before applying the requested date interval.
   // matchedEvents is a count only within this explicitly reported scan window.
   events.sort(sortEvents);const scanned=events.slice(0,SCAN_LIMIT),matches=scanned.filter(item=>(!query.from||item.date!==null&&item.date>=query.from)&&(!query.to||item.date!==null&&item.date<=query.to));
   coverage.scannedEvents=scanned.length;coverage.matchedEvents=matches.length;coverage.scanTruncated=events.length>SCAN_LIMIT;
   result.items=matches.slice(0,query.limit);result.truncated=coverage.scanTruncated||matches.length>query.limit;result.observedAt=this.now().toISOString();return result;
  }catch(cause){if(cause instanceof PlatformError&&cause.code==='DATA_READER_INCOMPATIBLE')throw cause;return unavailable();}
 }
}
