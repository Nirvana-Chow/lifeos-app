import type {InboxDraft} from '../platform/domain.ts';
import type {PublicEntry} from '../platform/contracts.ts';

export const recordTypes=['learning','career','mood','article','resource','project','training'] as const;
export type RecordType=typeof recordTypes[number];
type SyntheticRecord={syntheticOnly:true};
export type LearningRecord=SyntheticRecord&{type:'learning';topic:string;status:'planned'|'active'|'done';nextStep:string|null;resourceURL:string|null};
export type CareerRecord=SyntheticRecord&{type:'career';evidence:string;nextStep:string|null};
export type MoodRecord=SyntheticRecord&{type:'mood';label:string;intensity:1|2|3|4|5|null};
export type ArticleRecord=SyntheticRecord&{type:'article';author:string|null;attribution:'original'|'excerpt'|'summary';sourceURL:string|null};
export type ResourceRecord=SyntheticRecord&{type:'resource';url:string;author:string|null};
/** These claims are entered by a person. They never constitute system test
 * evidence or acceptance of LifeOS itself. Review concerns this synthetic item. */
export type ProjectReview={decision:'pending'|'accepted'|'rejected';evidence:string|null};
export type ProjectLinkType='todo'|'resource'|'article';
export type ProjectLink={type:ProjectLinkType;id:string;sourceId:string;revision:number};
export type ProjectLinkCandidate={link:ProjectLink;title:string;summary:string;updatedAt:string};
export type ProjectLinkCandidatesResponse={items:ProjectLinkCandidate[];limit:50;truncated:boolean;observedAt:string;dataStatus:'isolated-test-drafts';syntheticIncluded:boolean};
export type ProjectLinkState={link:ProjectLink;status:'current'|'updated'|'unavailable';current:ProjectLinkCandidate|null};
export type ProjectRecapResponse={project:RecordEntry;links:ProjectLinkState[];counts:{total:number;current:number;updated:number;unavailable:number;todo:number;resource:number;article:number};reviewApplicable:boolean;reviewApplicability:'pending'|'current'|'stale-links';observedAt:string;readOnly:true;aiGenerated:false;snapshotConsistency:'owner-snapshot';freshness:'refresh-to-check';dataStatus:'isolated-test-drafts';syntheticIncluded:true};
export type ProjectRecord=SyntheticRecord&{
 type:'project';stage:'idea'|'planned'|'active'|'paused'|'closed';nextStep:string|null;
 completion:{selfReported:true;status:'not-complete'|'complete';evidence:string|null};
 testing:{manuallyRecorded:true;outcome:'not-run'|'passed'|'failed'|'blocked';evidence:string|null};
 review:ProjectReview;
 /** Optional only for legacy snapshots. New normalized records contain []. */
 links?:ProjectLink[];
};
export type TrainingSet={reps:number|null;weight:{value:number;unit:'kg'|'lb'}|null;duration:{value:number;unit:'s'|'min'}|null};
export type TrainingRecord=SyntheticRecord&{type:'training';exercise:string|null;sets:TrainingSet[]};
export type RecordMetadata=TrainingRecord|LearningRecord|CareerRecord|MoodRecord|ArticleRecord|ResourceRecord|ProjectRecord;
export type ProjectReviewCommand={expectedRevision:number;decision:'accepted'|'rejected';evidence:string;confirmed:true;syntheticOnly:true};

/** Full replacement of editable fields on typed POST/PATCH. Optional metadata
 * text/URL/intensity may be omitted or empty at runtime; validation stores null.
 * All required signals are explicit: no status/attribution/mood inference.
 */
export type RecordFields={title:string;text:string;occurredOn:string|null;record:RecordMetadata};
export type CreateRecordCommand=RecordFields&{confirmed:true;syntheticOnly:true};
export type UpdateRecordCommand=CreateRecordCommand&{expectedRevision:number};
export type RecordEntry=Omit<PublicEntry,'kind'|'draft'>&{kind:'inbox';draft:InboxDraft&{record:RecordMetadata;disposition:'reference'}};
export type RecordMutationResult={entry:RecordEntry;duplicate:boolean};
export type RecordListResponse={items:RecordEntry[];dataStatus:'isolated-test-drafts';syntheticIncluded:boolean};
export type RecordDetailResponse={entry:RecordEntry};
export type RecordHistoryResponse={history:RecordEntry[];limit:100};
export type RecordErrorResponse={error:{code:string;message:string}};
