import type {Requirement} from '../platform/requirements.ts';
import type {RequirementWorkflow} from '../requirements-candidate/domain.ts';

export const deliveryLabels = {
 not_implemented: '尚未实现',
 in_progress: '进行中',
 merged: '已合并待上线',
 live: '已上线',
 unverified: '待核实',
} as const;
export type DeliveryState = keyof typeof deliveryLabels;

const repo = 'https://github.com/Nirvana-Chow/lifeos-app/';
const commitRef = /^https:\/\/github\.com\/Nirvana-Chow\/lifeos-app\/commit\/[a-f0-9]{40}$/;
const verificationRef = /^https:\/\/github\.com\/Nirvana-Chow\/lifeos-app\/blob\/[a-f0-9]{40}\/docs\/verification\/[a-z0-9.-]+\.md(?:#[a-z0-9-]+)?$/;
const productionRoute = /^https:\/\/lifeos\.nirvanachow\.com\/(?:personal(?:\/[a-z0-9-]+)*)(?:\?page=[a-z0-9-]+)?$/;

// These PRs cover the named result only. A merged slice can establish progress
// even when the broader public baseline still carries an older status.
const mergedSlices = new Map<string, {label:string; href:string}>([
 ['LO-REQ-001', {label:'需求浏览、搜索与筛选', href:repo+'pull/31'}],
 ['LO-PEOPLE-001', {label:'人物只读总览', href:repo+'pull/93'}],
 ['LO-FIN-001', {label:'已记录资金流向', href:repo+'pull/97'}],
 ['LO-JOURNAL-001', {label:'日记活动热力图', href:repo+'pull/98'}],
]);

export type RequirementDelivery = {
 state: DeliveryState;
 result?: {label:string; href:string; evidence?:string};
};

// Delivery evidence is read from the engineering baseline. Private descriptions,
// workflow selections, ordinary PR references and build qualification cannot
// supply a receipt. Production evidence cites both a fixed source and the
// corresponding verified official route.
export function requirementDelivery(item:Requirement, workflow?:RequirementWorkflow|null):RequirementDelivery {
 const merged = item.evidence.findLast(evidence => evidence.scope==='delivery-merged' && commitRef.test(evidence.ref));
 const production = item.evidence.find(evidence =>
  evidence.scope==='delivery-production-verified' &&
  evidence.ref===merged?.ref &&
  typeof evidence.resultHref==='string' && productionRoute.test(evidence.resultHref) &&
  typeof evidence.verificationHref==='string' && verificationRef.test(evidence.verificationHref));
 if (production?.resultHref) {
  return {state:'live',result:{label:'打开正式站结果',href:production.resultHref,evidence:production.verificationHref}};
 }
 if (merged) return {state:'merged',result:{label:'查看合并结果',href:merged.ref}};
 const slice = mergedSlices.get(item.id);
 const result = slice && {...slice,label:slice.label+'（合并记录）'};
 if (workflow?.state==='done' || item.roadmap?.implementation==='implemented' ||
     item.status==='accepted' || item.status==='awaiting_acceptance') {
  return {state:'unverified',result};
 }
 if (slice || workflow && ['in_progress','blocked','awaiting_review'].includes(workflow.state) ||
     item.roadmap?.implementation==='partial' || item.status==='in_progress') {
  return {state:'in_progress',result};
 }
 if (workflow?.state==='planned' ||
     item.id.startsWith('LO-') && item.roadmap?.implementation==='not_started' && item.status==='not_started') {
  return {state:'not_implemented'};
 }
 return {state:'unverified'};
}
