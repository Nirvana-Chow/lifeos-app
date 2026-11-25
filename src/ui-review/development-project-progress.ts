import {requirements} from '../platform/requirements.ts';
import {readRequirementItem} from '../requirements-candidate/client.ts';
import {requirementDelivery, type DeliveryState} from './requirements-delivery.ts';

const lifeOSBaseline = requirements();
const lifeOSRequirements = new Map(lifeOSBaseline.requirements.map(requirement => [requirement.id, requirement]));

export function readLifeOSDevelopmentProgress(value: unknown) {
  const snapshot = value as Record<string, unknown> | null;
  if (!snapshot || snapshot.scope !== 'full-current-requirements-snapshot' || snapshot.truncated !== false ||
      !Array.isArray(snapshot.items) || snapshot.items.length > 10000 || snapshot.total !== snapshot.items.length) {
    throw Error('需求快照不完整。');
  }
  const items = snapshot.items.map(readRequirementItem);
  if (items.some(item => item.id !== item.requirement.id) || new Set(items.map(item => item.id)).size !== items.length) {
    throw Error('需求标识无效。');
  }
  const byId = new Map(items.map(item => [item.id, item]));

  const counts: Record<DeliveryState, number> = {not_implemented:0, in_progress:0, merged:0, live:0, unverified:0};
  for (const [id, requirement] of lifeOSRequirements) {
    const item = byId.get(id);
    if (!item) throw Error('LifeOS 网站需求基线不完整。');
    // The public baseline identifies this website. Owner-added requirements without
    // that binding have no authoritative association to a development project.
    if (item.baselineConflict || item.baselineBinding?.baselineVersion !== lifeOSBaseline.baselineVersion ||
        item.baselineBinding.itemVersion !== requirement.version || item.requirement.version !== requirement.version) {
      counts.unverified++;
      continue;
    }
    const {state} = requirementDelivery(requirement, item.fields.workflow);
    counts[state]++;
  }
  const candidate = snapshot.observedAt;
  const parsed = typeof candidate === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(candidate)
    ? new Date(candidate) : null;
  const observedAt = parsed && Number.isFinite(+parsed) && typeof candidate === 'string' &&
    parsed.toISOString() === candidate.replace(/(?<!\.\d{3})Z$/, '.000Z') ? candidate : null;
  return {counts, observedAt};
}
