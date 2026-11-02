import type {StoredEntry,Kind} from './contracts.ts';
import type {SearchQuery,SearchHit} from '../search-candidate/contracts.ts';
import type {TimelineQuery,TimelineItem} from '../timeline-candidate/contracts.ts';
export type WindowKey={at:string;id:string;revision:number};
export type WindowPosition={anchor:WindowKey|null;after:WindowKey|null};
export type WindowRow={entry:StoredEntry;currentRevision:number;currentSourceId:string;currentKind:Kind;key:WindowKey};
export type WindowMode='current'|'history';
export type RecordWindowResponse={mode:'search'|'timeline';query:SearchQuery|TimelineQuery;items:(SearchHit|TimelineItem)[];observedAt:string;syntheticIncluded:boolean;dataStatus:'isolated-test-drafts';page:{cursorUsed:string|null;nextCursor:string|null;hasMore:boolean;scanned:number;returned:number;limit:number;ordering:'record-createdAt-desc-id-desc'|'history-createdAt-desc-id-desc-revision-desc';consistency:'per-page-read-not-snapshot';compatibilityScope:'scanned-versions-and-originals';filtering:'bounded-window-post-filter';totalMatches:null;calendarIncluded:false;newerRecordsRequireRestart:true;revisionsMayChange:true;backdatedInsertionsMayBeMissed:true}};
