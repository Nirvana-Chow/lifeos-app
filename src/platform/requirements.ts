import baseline from './public-requirements.json' with {type: 'json'};

export type ImplementationStatus = 'not_started' | 'partial' | 'implemented';
export type RoadmapPhase = {id: string; order: number; title: string; goal: string};
export type RequirementRoadmap = {
 phaseId: string;
 priority: 'P0' | 'P1' | 'P2' | 'P3';
 implementation: ImplementationStatus;
 summary: string;
 nextStep: string;
 issueRefs: string[];
 prRefs: string[];
 specTaskRefs: string[];
};
export type Requirement = {
 id: string; version: number; title: string; description: string;
 status: 'not_started' | 'in_progress' | 'awaiting_acceptance' | 'accepted';
 delivery: 'current' | 'backlog'; sourceRefs: string[]; acceptanceCriteria: string[];
 evidence: {scope: string; ref: string}[]; blockedBy: string[];
 acceptance?: {by: 'user'; baselineVersion: string; ref: string};
 roadmap?: RequirementRoadmap;
};
export type RequirementBaseline = {
 baselineVersion: string; candidateVersion: string; scopeNote: string; newIdeaPolicy: string;
 requirements: Requirement[];
 roadmap?: {goal: string; currentPhaseId: string; nextStep: string; phases: RoadmapPhase[]};
};
const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const publicIssue = /^https:\/\/github\.com\/Nirvana-Chow\/lifeos-app\/issues\/[1-9]\d*$/;
const publicPR = /^https:\/\/github\.com\/Nirvana-Chow\/lifeos-app\/pull\/[1-9]\d*$/;
const specTask = /^openspec\/changes\/[a-z0-9-]+\/tasks\.md#\d+\.\d+$/;
function refs(value: unknown, format: RegExp): boolean {
 return Array.isArray(value) && value.every(ref => typeof ref === 'string' && format.test(ref));
}
export function validateRequirementBaseline(input: unknown): RequirementBaseline {
 const b = input as RequirementBaseline;
 if (!b || !nonempty(b.baselineVersion) || !nonempty(b.candidateVersion) || !nonempty(b.scopeNote) || !Array.isArray(b.requirements) || !b.requirements.length || b.newIdeaPolicy !== 'backlog-requires-explicit-scope') throw Error('Invalid baseline.');
 const phases = new Set<string>(), orders = new Set<number>();
 if (b.roadmap !== undefined) {
  const m = b.roadmap;
  if (!m || !nonempty(m.goal) || !nonempty(m.nextStep) || !nonempty(m.currentPhaseId) || !Array.isArray(m.phases) || !m.phases.length) throw Error('Invalid roadmap.');
  for (const p of m.phases) {
   if (!p || !nonempty(p.id) || !/^[a-z][a-z0-9-]*$/.test(p.id) || phases.has(p.id) || !Number.isSafeInteger(p.order) || p.order < 1 || orders.has(p.order) || !nonempty(p.title) || !nonempty(p.goal)) throw Error('Invalid roadmap phase.');
   phases.add(p.id); orders.add(p.order);
  }
  if (!phases.has(m.currentPhaseId)) throw Error('Invalid roadmap current phase.');
 }
 const ids = new Set<string>();
 for (const r of b.requirements) {
  if (!r || typeof r.id !== 'string' || !/^LO-[A-Z]+-\d{3}$/.test(r.id) || ids.has(r.id)) throw Error('Invalid or duplicate requirement ID.'); ids.add(r.id);
  if (!Number.isSafeInteger(r.version) || r.version < 1 || !nonempty(r.title) || !nonempty(r.description) || !['not_started', 'in_progress', 'awaiting_acceptance', 'accepted'].includes(r.status) || !['current', 'backlog'].includes(r.delivery)) throw Error('Invalid requirement.');
  if (!Array.isArray(r.sourceRefs) || !r.sourceRefs.length || !r.sourceRefs.every(nonempty)) throw Error('Requirement source is missing.');
  if (!Array.isArray(r.acceptanceCriteria) || !r.acceptanceCriteria.length || !r.acceptanceCriteria.every(nonempty) || !Array.isArray(r.evidence) || !r.evidence.every(e => e && nonempty(e.scope) && nonempty(e.ref)) || !Array.isArray(r.blockedBy) || !r.blockedBy.every(nonempty)) throw Error('Invalid acceptance criteria or evidence.');
  if (r.status === 'accepted' && (!r.acceptance || r.acceptance.by !== 'user' || r.acceptance.baselineVersion !== b.baselineVersion || !nonempty(r.acceptance.ref))) throw Error('User acceptance evidence for this baseline is required.');
  if (r.roadmap !== undefined) {
   const m = r.roadmap;
   if (!m || !phases.has(m.phaseId) || !['P0', 'P1', 'P2', 'P3'].includes(m.priority) || !['not_started', 'partial', 'implemented'].includes(m.implementation) || !nonempty(m.summary) || !nonempty(m.nextStep) || !refs(m.issueRefs, publicIssue) || !refs(m.prRefs, publicPR) || !refs(m.specTaskRefs, specTask)) throw Error('Invalid requirement roadmap metadata.');
   if (m.implementation !== 'not_started' && !r.evidence.some(e => e.scope === 'source')) throw Error('Roadmap implementation requires source evidence.');
  }
 }
 return b;
}
function freeze<T>(v: T): T {if (v && typeof v === 'object') {for (const child of Object.values(v)) freeze(child); Object.freeze(v);} return v;}
const fixed = freeze(validateRequirementBaseline(baseline));
export function requirements(): RequirementBaseline {return fixed;}

export type RequirementFilters = {
 query?: string;
 implementation?: ImplementationStatus | 'all';
 phase?: string;
 priority?: RequirementRoadmap['priority'] | 'all';
 acceptance?: Requirement['status'] | 'all';
};

export function selectRequirements(b: RequirementBaseline, filter: RequirementFilters = {}): Requirement[] {
 const query = (filter.query ?? '').trim().normalize('NFKC').toLowerCase();
 const orders = new Map(b.roadmap?.phases.map(p => [p.id, p.order]));
 return b.requirements.filter(r => {
  if (filter.implementation && filter.implementation !== 'all' && r.roadmap?.implementation !== filter.implementation) return false;
  const m = r.roadmap;
  if (filter.phase && filter.phase !== 'all' && m?.phaseId !== filter.phase) return false;
  if (filter.priority && filter.priority !== 'all' && m?.priority !== filter.priority) return false;
  if (filter.acceptance && filter.acceptance !== 'all' && r.status !== filter.acceptance) return false;
  return !query || [r.id, r.title, r.description, ...r.sourceRefs, ...r.acceptanceCriteria, ...r.blockedBy, m?.summary, m?.nextStep, ...(m?.issueRefs ?? []), ...(m?.prRefs ?? []), ...(m?.specTaskRefs ?? [])].join('\n').normalize('NFKC').toLowerCase().includes(query);
 }).toSorted((a, c) => (orders.get(a.roadmap?.phaseId ?? '') ?? 99) - (orders.get(c.roadmap?.phaseId ?? '') ?? 99));
}
