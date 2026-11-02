export type TimelineAxis='occurred'|'recorded'|'changed';
export type TimelineQuery={axis:TimelineAxis;from?:string;to?:string;timeZone:string;type?:string;includeSynthetic:boolean;limit:number};
export type TimelineItem={
 eventKey:string;id:string;kind:'todo'|'finance'|'inbox'|'calendar';type:string;sourceId:string;
 revision:number;currentRevision:number;title:string;summary:string;
 date:string|null;at:string|null;dateKind:'date'|'instant'|'unknown';
 timeRole:'occurred'|'due'|'scheduled'|'recorded'|'changed';sourceTimeZone:string|null;
 status:string|null;isHistorical:boolean;
};
export type TimelineResponse={
 items:TimelineItem[];query:TimelineQuery;limit:number;truncated:boolean;observedAt:string;
 dataStatus:'isolated-test-drafts';syntheticIncluded:boolean;
 coverage:{
  currentRecords:number;firstRecordedAt:string|null;lastRecordedAt:string|null;
  recordedDateCount:number;recordedFrom:string|null;recordedTo:string|null;
  unknownOccurredRecords:number;matchedEvents:number;scannedEvents:number;
  scanLimit:2000;scanTruncated:boolean;calendarAvailable:boolean;
  snapshotConsistency:'owner-snapshot'|'per-adapter-snapshots';meaning:'existing-record-coverage-only';
 };
};
/** Recorded dates of extant current records, never a measure of activities. */
export type TimelineComparisonQuery={aFrom:string;aTo:string;bFrom:string;bTo:string;timeZone:string;type?:string;includeSynthetic:boolean;limit:number};
export type TimelineComparisonPeriod={
 from:string;to:string;calendarDays:number;recordCount:number;recordedDays:number;recordedDayRatio:number;
 items:TimelineItem[];itemsTruncated:boolean;
};
export type TimelineComparisonResponse={
 query:TimelineComparisonQuery;observedAt:string;dataStatus:'isolated-test-drafts';syntheticIncluded:boolean;
 comparison:null|{a:TimelineComparisonPeriod;b:TimelineComparisonPeriod;overlap:{from:string|null;to:string|null;calendarDays:number;recordCount:number}};
 coverage:{currentRecords:number|null;calendarAvailable:boolean;snapshotConsistency:'owner-snapshot'|'per-adapter-snapshots';summaryScope:'all-current-snapshot-records';meaning:'existing-record-coverage-only'};
};
