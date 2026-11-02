import {PlatformError,validateRevision,validateId} from './domain.ts';
import {assertReadableEntries} from './data-compatibility.ts';
import {windowKey,compareWindowKeys,decodeWindowCursor,encodeWindowCursor} from './window-domain.ts';
import {parseSearchQuery,projectWindowSearchHit} from '../search-candidate/service.ts';
import {parseTimelineQuery} from '../timeline-candidate/domain.ts';
import {projectWindowTimelineEvent} from '../timeline-candidate/service.ts';
import type {PlatformRepository,PublicEntry} from './contracts.ts';
import type {RecordWindowResponse,WindowRow,WindowMode} from './window-contracts.ts';
const unavailable=():never=>{throw new PlatformError(503,'WINDOW_STORAGE_UNAVAILABLE','存储未提供可核对的有界分页；没有退回全量读取。');};
export class RecordWindowService{
 private repository:PlatformRepository;private now:()=>Date;
 constructor(repository:PlatformRepository,now:()=>Date=()=>new Date()){this.repository=repository;this.now=now;}
 async page(owner:string,mode:'search'|'timeline',params:URLSearchParams):Promise<RecordWindowResponse>{
  const q=new URLSearchParams(params),cursors=q.getAll('cursor');if(cursors.length>1||cursors.length&&cursors[0]==='')throw new PlatformError(400,'INVALID_WINDOW_CURSOR','分页位置无效。');const cursor=cursors[0]??null;q.delete('cursor');
  const query=mode==='search'?parseSearchQuery(q):parseTimelineQuery(q),storageMode:WindowMode=mode==='timeline'&&'axis'in query&&query.axis==='changed'?'history':'current',limit=query.limit!;
  if(query.type==='calendar')throw new PlatformError(400,'WINDOW_SCOPE_UNSUPPORTED','日历还没有有界分页适配器，本次仅包含核心站内记录。');
  const position=decodeWindowCursor(owner,{mode,query},cursor,storageMode),result:RecordWindowResponse={mode,query,items:[],observedAt:this.now().toISOString(),syntheticIncluded:query.includeSynthetic,dataStatus:'isolated-test-drafts',page:{cursorUsed:cursor,nextCursor:null,hasMore:false,scanned:0,returned:0,limit,ordering:storageMode==='current'?'record-createdAt-desc-id-desc':'history-createdAt-desc-id-desc-revision-desc',consistency:'per-page-read-not-snapshot',compatibilityScope:'scanned-versions-and-originals',filtering:'bounded-window-post-filter',totalMatches:null,calendarIncluded:false,newerRecordsRequireRestart:true,revisionsMayChange:true,backdatedInsertionsMayBeMissed:true}};
  if(!query.includeSynthetic)return result;
  if(!this.repository.readWindow)return unavailable();
  const rows=await this.repository.readWindow(owner,storageMode,position,limit+1);if(!Array.isArray(rows)||rows.length>limit+1)return unavailable();
  const seen=new Set<string>();let prior:WindowRow|undefined;
  for(const row of rows){const e=row?.entry;if(!e||e.ownerId!==owner||!['todo','finance','inbox'].includes(e.kind)||e.syncState!=='draft'||e.externalStatus!==null||row.currentKind!==e.kind)return unavailable();
   const expected=windowKey(storageMode==='current'?e.createdAt:e.updatedAt,e.id,storageMode==='current'?0:e.revision,storageMode);if(JSON.stringify(expected)!==JSON.stringify(row.key)||validateId(row.currentSourceId)!==e.source.id||validateRevision(row.currentRevision)<validateRevision(e.revision)||storageMode==='current'&&row.currentRevision!==e.revision)return unavailable();
   const key=JSON.stringify(row.key);if(seen.has(key)||prior&&compareWindowKeys(prior.key,row.key)<=0||position.anchor&&compareWindowKeys(row.key,position.anchor)>0||position.after&&compareWindowKeys(row.key,position.after)>=0)return unavailable();seen.add(key);prior=row;
   // The lookahead row is checked too. This scope cannot attest unscanned data.
   assertReadableEntries([e]);
  }
  const scanned=rows.slice(0,limit);for(const row of scanned){const {ownerId,...publicRow}=row.entry;void ownerId;const entry=publicRow as PublicEntry;
   const projected=mode==='search'?projectWindowSearchHit({kind:entry.kind,entry},query as ReturnType<typeof parseSearchQuery>):projectWindowTimelineEvent({kind:entry.kind,entry},row.currentRevision,query as ReturnType<typeof parseTimelineQuery>);
   if(projected)result.items.push(projected);
  }
  result.page.scanned=scanned.length;result.page.returned=result.items.length;result.page.hasMore=rows.length>limit;const last=scanned.at(-1),anchor=position.anchor??scanned[0]?.key??null;
  if(result.page.hasMore&&last&&anchor)result.page.nextCursor=encodeWindowCursor(owner,{mode,query},{anchor,after:last.key});result.observedAt=this.now().toISOString();return result;
 }
}
