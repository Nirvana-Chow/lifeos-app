export type SearchKind='todo'|'finance'|'inbox'|'calendar';
export type SearchQuery={q:string;from?:string;to?:string;type?:string;includeSynthetic:boolean;limit?:number};
export type SearchHit={id:string;kind:SearchKind;type:string;title:string;date:string|null;sourceId:string;sourceSystem:string;snippet:string;revision:number};
export type SearchDocument=SearchHit&{fields:Array<{label:string;value:string}>};
export type SearchResponse={items:SearchHit[];limit:number;truncated:boolean;scanned:number;dataStatus:'isolated-test-drafts';syntheticIncluded:boolean;coverage:{scanLimit:number;scanTruncated:boolean;calendarAvailable:boolean}};
export type SourceResponse={current:SearchDocument;original:SearchDocument;history:SearchDocument[];historyLimit:number;historyTruncated:boolean;dataStatus:'isolated-test-drafts';syntheticIncluded:true};
