import test from 'node:test';
import assert from 'node:assert/strict';
import {beijingJournalDate,projectJournalHistory,journalRecordHref,readJournalHistory,readJournalOriginal} from '../src/personal-journal/history.ts';
import {journalFixture,journalStatus,journalWithTopic,topicFixture} from './helpers/journal-history.ts';

test('history today uses the server instant in Beijing across midnight, independent of client timezone',()=>{
 assert.equal(beijingJournalDate('2026-11-12T15:59:59.000Z'),'2026-11-12');
 assert.equal(beijingJournalDate('2026-11-12T16:00:00.000Z'),'2026-11-13');
 assert.throws(()=>beijingJournalDate('2026-11-13'));
 assert.throws(()=>beijingJournalDate('2026-02-30T00:00:00.000Z'));
});
test('same-day history uses recorded dates, strictly past years and stable IDs',()=>{
 const entries=[journalFixture(5,'2026-11-13'),journalFixture(4,'2027-11-13'),journalFixture(3,'2025-11-13'),journalFixture(1,'2024-11-13'),journalFixture(2,'2025-11-13'),journalFixture(6,'2025-11-12'),journalFixture(7,null)];
 const result=projectJournalHistory(entries,'2026-11-12T16:00:00.000Z');
 assert.equal(result.today,'2026-11-13');
 assert.deepEqual(result.matches.map(row=>row.id),[entries[2].id,entries[4].id,entries[3].id]);
 assert.deepEqual(result.coverage,{count:7,dated:6,undated:1,from:'2024-11-13',to:'2027-11-13',historicalCompleteness:'unknown'});
 assert.equal(result.matches[0].href,'/personal/journal?record='+entries[2].id);
 assert.throws(()=>journalRecordHref('../private'));
});
test('one verified history projection carries every saved date and its stable source revision',()=>{
 const original=journalFixture(1,'2026-11-13'),entry={...original,revision:3,draft:{...original.draft,text:'Revised synthetic text'}},undated=journalFixture(2,null);
 const result=projectJournalHistory([entry,undated],'2026-11-13T00:00:00.000Z');
 assert.equal(result.rows.length,2);
 assert.deepEqual(result.rows.find(row=>row.id===entry.id),{id:entry.id,sourceId:entry.source.id,revision:3,title:'Synthetic diary 1',text:'Revised synthetic text',occurredOn:'2026-11-13',href:journalRecordHref(entry.id)});
 assert.equal(result.rows.find(row=>row.id===undated.id)?.occurredOn,null);
});
test('leap-day records are only shown on February 29 and empty coverage remains unknown',()=>{
 assert.equal(projectJournalHistory([journalFixture(1,'2020-02-29')],'2024-02-29T04:00:00.000Z').matches.length,1);
 assert.equal(projectJournalHistory([journalFixture(1,'2020-02-29')],'2025-02-28T04:00:00.000Z').matches.length,0);
 assert.deepEqual(projectJournalHistory([],'2026-11-13T04:00:00.000Z').coverage,{count:0,dated:0,undated:0,from:null,to:null,historicalCompleteness:'unknown'});
});
function fetcher(routes:Record<string,unknown>){return async(input:RequestInfo|URL)=>Response.json(routes[String(input)]);}
const root='/api/platform/personal/';
test('history accepts only the complete validated owner snapshot, never partial counts or foreign records',async()=>{
 const entry=journalFixture(1,'2025-11-13');
 const routes={[root+'status']:journalStatus,[root+'journal/snapshot']:{scope:'full-current-snapshot',items:[entry],total:1,truncated:false,observedAt:'2026-11-13T00:00:00.000Z'}};
 assert.equal((await readJournalHistory(fetcher(routes))).history.matches[0].id,entry.id);
 for(const patch of [{truncated:true},{total:2},{scope:'bounded-window'},{observedAt:'invalid'},{items:[{...entry,source:{...entry.source,original:{}}}]}])await assert.rejects(readJournalHistory(fetcher({...routes,[root+'journal/snapshot']:{...routes[root+'journal/snapshot'],...patch}})));
});
test('history rejects identity changes across reads and closed or unauthenticated access',async()=>{
 let reads=0;
 await assert.rejects(readJournalHistory(async input=>String(input).endsWith('/status')?Response.json({...journalStatus,spaceId:++reads===1?journalStatus.spaceId:'changed'}):Response.json({scope:'full-current-snapshot',items:[],total:0,truncated:false,observedAt:'2026-11-13T00:00:00.000Z'})));
 await assert.rejects(readJournalHistory(async()=>Response.json({error:{message:'Sign in'}},{status:401})));
 await assert.rejects(readJournalHistory(fetcher({[root+'status']:{...journalStatus,allowedTypes:[]}})));
});
test('original link reads the selected stable record and preserves immutable original independently of edits',async()=>{
 const original=journalFixture(1,'2025-11-13'),entry={...original,revision:2,draft:{...original.draft,text:'Synthetic corrected diary'}};
 const routes={[root+'status']:journalStatus,[root+'journal/'+entry.id]:{entry},[root+'journal/'+entry.id+'/history']:{items:[entry,original],scope:'bounded-record-history',truncated:false}};
 const result=await readJournalOriginal(fetcher(routes),entry.id,journalStatus);
 assert.equal(result.entry.id,entry.id);assert.equal(result.original.text,'Synthetic original diary');assert.equal(result.current.text,'Synthetic corrected diary');
 await assert.rejects(readJournalOriginal(fetcher({...routes,[root+'journal/'+entry.id]:{entry:journalFixture(2,'2025-11-13')}}),entry.id,journalStatus));
 await assert.rejects(readJournalOriginal(fetcher({...routes,[root+'status']:{...journalStatus,ownerId:'another'}}),entry.id,journalStatus));
});
test('an original GET must reject a reference superseded since the full snapshot',async()=>{
 const entry=journalFixture(1,'2026-11-13');
 const routes={[root+'status']:journalStatus,[root+'journal/'+entry.id]:{entry},[root+'journal/'+entry.id+'/history']:{items:[entry],scope:'bounded-record-history',truncated:false}};
 const reference={id:entry.id,sourceId:entry.source.id,revision:entry.revision};
 assert.equal((await readJournalOriginal(fetcher(routes),entry.id,journalStatus,reference)).entry.id,entry.id);
 for(const changed of [{...reference,revision:2},{...reference,sourceId:journalFixture(2,null).source.id},{...reference,id:journalFixture(2,null).id}]){
  await assert.rejects(readJournalOriginal(fetcher(routes),entry.id,journalStatus,changed),/版本已变化/);
 }
});

test('only an exact, current owner topic pin classifies a record as a memo',async()=>{
 const memoTopic=topicFixture(101,'随手记'),thinking=topicFixture(102,'思考'),ordinary=topicFixture(103,'阅读思考整理');
 const memo=journalWithTopic(journalFixture(1,'2025-11-13','Existing memo source text'),memoTopic);
 const thought=journalWithTopic(journalFixture(2,'2026-11-13'),thinking);
 const diary=journalWithTopic(journalFixture(3,'2026-11-13','正文提到随手记和思考'),ordinary);
 const stale=journalWithTopic(journalFixture(4,'2026-11-13'),{...memoTopic,revision:2});
 const items=[memo,thought,diary,stale],topics=[memoTopic,thinking,ordinary];
 const snapshot=(items:unknown[])=>({scope:'full-current-snapshot',items,total:items.length,truncated:false,observedAt:'2026-11-12T16:00:00.000Z'});
 const routes={[root+'status']:{...journalStatus,allowedTypes:['journal','topic']},[root+'journal/snapshot']:snapshot(items),[root+'topic/snapshot']:snapshot(topics)};
 const result=await readJournalHistory(fetcher(routes));
 assert.deepEqual(result.sources.memos.rows.map(row=>row.id).sort(),[memo.id,thought.id]);
 assert.deepEqual(result.sources.diary.rows.map(row=>row.id),[diary.id]);
 assert.deepEqual(result.sources.unclassified.map(row=>row.id),[stale.id]);
 assert.equal(result.sources.memos.matches[0].text,'Existing memo source text');
 assert.equal(result.history.rows.length,4);
 const unchecked=await readJournalHistory(fetcher({...routes,[root+'topic/snapshot']:{...snapshot(topics),truncated:true}}));
 assert.equal(unchecked.sources.memos.rows.length,0);
 assert.equal(unchecked.sources.diary.rows.length,0);
 assert.equal(unchecked.sources.unclassified.length,4);
});
