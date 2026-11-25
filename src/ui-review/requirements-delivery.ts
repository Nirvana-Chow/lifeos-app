import type {Requirement} from '../platform/requirements.ts';
import type {RequirementWorkflow} from '../requirements-candidate/domain.ts';
import {savedProgressEntries} from './requirements-progress.ts';

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
export const mergedSlices: ReadonlyMap<string, {label:string; href:string; at:string}> = new Map([
 ['LO-REQ-001', {label:'需求池精简与交付状态', href:repo+'pull/103', at:'2026-11-25T01:35:18Z'}],
 ['LO-PEOPLE-001', {label:'人物只读总览', href:repo+'pull/93', at:'2026-11-25T00:29:27Z'}],
 ['LO-FIN-001', {label:'已记录资金流向', href:repo+'pull/97', at:'2026-11-25T00:38:15Z'}],
 ['LO-JOURNAL-001', {label:'日记活动热力图', href:repo+'pull/98', at:'2026-11-24T23:50:00Z'}],
]);

type DeliveryTime = {at:string; label:'上线核验'|'合并'|'部分合并'|'跟进'};
export type RequirementDelivery = {
 state: DeliveryState;
 time?: DeliveryTime;
 result?: {label:string; href:string; evidence?:string};
};

const dateFormat = new Intl.DateTimeFormat('zh-CN',{
 timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
});
export function formatDeliveryTime(at:string){return dateFormat.format(new Date(at));}

function evidenceTime(at:string|undefined,label:DeliveryTime['label']):DeliveryTime|undefined {
 if (!at || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(at)) return;
 const date = new Date(at);
 if (!Number.isFinite(date.valueOf()) || date.toISOString()!==at.replace(/(?<!\.\d{3})Z$/,'.000Z')) return;
 return {at,label};
}

// Delivery evidence is read from the engineering baseline. Private descriptions,
// workflow selections, ordinary PR references and build qualification cannot
// supply a receipt. Production evidence cites both a fixed source and the
// corresponding verified official route.
export function requirementDelivery(item:Requirement, workflow?:RequirementWorkflow|null, savedBody=''):RequirementDelivery {
 const merged = item.evidence.findLast(evidence => evidence.scope==='delivery-merged' && commitRef.test(evidence.ref));
 const production = item.evidence.find(evidence =>
  evidence.scope==='delivery-production-verified' &&
  evidence.ref===merged?.ref &&
  typeof evidence.resultHref==='string' && productionRoute.test(evidence.resultHref) &&
  typeof evidence.verificationHref==='string' && verificationRef.test(evidence.verificationHref));
 if (production?.resultHref) {
  return {state:'live',time:evidenceTime(production.at,'上线核验'),result:{label:'打开正式站结果',href:production.resultHref,evidence:production.verificationHref}};
 }
 if (merged) return {state:'merged',time:evidenceTime(merged.at,'合并'),result:{label:'查看合并结果',href:merged.ref}};
 const slice = mergedSlices.get(item.id);
 const result = slice && {href:slice.href,label:slice.label+'（合并记录）'};
 const followUp = savedProgressEntries(savedBody)[0];
 const time = followUp && (!slice || Date.parse(followUp.at)>=Date.parse(slice.at))
  ? {at:followUp.at,label:'跟进' as const}
  : evidenceTime(slice?.at,'部分合并');
 if (workflow?.state==='done' || item.roadmap?.implementation==='implemented' ||
     item.status==='accepted' || item.status==='awaiting_acceptance') {
  return {state:'unverified',result,time};
 }
 if (slice || workflow && ['in_progress','blocked','awaiting_review'].includes(workflow.state) ||
     item.roadmap?.implementation==='partial' || item.status==='in_progress') {
  return {state:'in_progress',result,time};
 }
 if (workflow?.state==='planned' ||
     item.id.startsWith('LO-') && item.roadmap?.implementation==='not_started' && item.status==='not_started') {
  return {state:'not_implemented',time};
 }
 return {state:'unverified',time};
}
