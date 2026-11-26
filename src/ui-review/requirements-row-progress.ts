import type {RequirementItem} from '../requirements-candidate/service.ts';
import {requirementDelivery, requirementIsComplete, type RequirementDelivery} from './requirements-delivery.ts';
import {savedProgressEntries} from './requirements-progress.ts';

type ProgressEvidence = {label: string; at?: string; href?: string};

export function requirementRowProgress(row: RequirementItem, delivery: RequirementDelivery | undefined, observedAt: string) {
 const {requirement:item} = row;
 const workflow = row.baselineConflict ? undefined : row.fields.workflow?.state;
 const engineering = requirementDelivery(item);
 let state = '推进未记录';
 if (requirementIsComplete(item, delivery)) state = '已完成';
 else if (workflow === 'blocked') state = '有阻塞';
 else if (engineering.state === 'live') state = '已上线，待验收';
 else if (engineering.state === 'merged') state = '待上线';
 else if (workflow === 'awaiting_review') state = '待工程检查';
 else if (workflow === 'done' || item.roadmap?.implementation === 'implemented' || item.status === 'awaiting_acceptance' || item.status === 'accepted') state = '待核实上线';
 else if (workflow === 'in_progress') state = '登记为开发中';
 else if (workflow === 'planned') state = '待开发';
 else if (item.blockedBy.length) state = '有阻塞';
 else if (engineering.state === 'in_progress') state = engineering.result ? '已有开发进展' : '登记为开发中';
 else if (engineering.state === 'not_implemented') state = '待开发';

 const through = Date.parse(observedAt);
 const proofTime = engineering.time && Date.parse(engineering.time.at) <= through ? engineering.time : undefined;
 const followUp = row.sourceId && row.revision > 0 && !row.baselineConflict
  ? savedProgressEntries(row.fields.body).find(entry => Date.parse(entry.at) <= through)
  : undefined;
 let latest: ProgressEvidence | undefined;
 if (followUp && (!proofTime || Date.parse(followUp.at) > Date.parse(proofTime.at))) {
  latest = {label:'已记录跟进', at:followUp.at};
 } else if (engineering.result) {
  latest = {label:engineering.result.label, href:engineering.result.href, at:proofTime?.at};
 }
 return {state, latest};
}
