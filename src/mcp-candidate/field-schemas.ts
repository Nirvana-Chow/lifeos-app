/** Discovery-only structural projection of the native Agent input contracts.
 * Do not normalize or persist here. The existing domain normalizers remain the
 * authority for dates, cross-field relations, current owner pins and business rules.
 */
import {z} from 'zod';
import {circumferenceSites} from '../personal-health/domain.ts';
import {requirementWorkflowStates} from '../requirements-candidate/domain.ts';
import type {FinanceDraft} from '../platform/domain.ts';

const text=(max:number,nonempty=false)=>z.string().max(max).min(nonempty?1:0).regex(/^[^\0]*$/).describe(nonempty?'Nonblank text; no NUL.':'Text; no NUL.');
export const recordId=z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i).meta({examples:['00000000-0000-4000-8000-000000000001']});
export const revision=z.number().int().min(1).max(2147483647).describe('Current record revision from GET; CAS rejects stale revisions.');
export const commandKey=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/).describe('Idempotency key: retain the same original key and body for retry of an unknown result.').meta({examples:['synthetic-command-0001']});
export const digest=z.string().regex(/^[a-f0-9]{64}$/);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Real YYYY-MM-DD civil date; dates are checked by the native normalizer.').meta({format:'date',examples:['2026-11-06']});
const optionalDate=date.nullable();
const planning={plannedStartOn:optionalDate.optional().describe('Omitted preserves saved date on PATCH; null clears. Start must not follow end.'),plannedEndOn:optionalDate.optional().describe('Omitted preserves saved date on PATCH; null clears. End must not precede start.')};
const instant=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/).describe('Explicit Z or UTC offset; native validation checks real time, selected zone and DST.').meta({examples:['2026-11-06T00:00:00Z']});
const zone=z.string().max(100).describe('Existing IANA zone, UTC, or explicit ±HH:MM offset; native validation checks zone/offset.').meta({examples:['UTC']});
const pin=z.strictObject({id:recordId,sourceId:recordId,revision}).describe('Exact current owner record/source/revision pin from snapshot or GET; never invent a pin.');
const pins=z.array(pin).max(20).describe('At most 20 distinct record IDs.');
const relationShape={project:pin.nullable().optional(),domain:pin.nullable().optional(),topics:pins.optional()};
export const relations=z.strictObject(relationShape);
const completeRelations=z.strictObject({project:pin.nullable(),domain:pin.nullable(),topics:pins});
const journal=z.strictObject({type:z.literal('journal'),links:z.strictObject({...relationShape,people:pins.optional()})});
const project=z.strictObject({type:z.literal('project'),stage:z.enum(['idea','planned','active','paused','closed']),purpose:z.enum(['maintain','advance','explore']).nullable(),nextStep:text(4000),domain:pin.nullable().optional(),topics:pins.optional(),...planning});
export const organizationPersonal={project,domain:z.strictObject({type:z.literal('domain')}),topic:z.strictObject({type:z.literal('topic')})};
const person=z.strictObject({type:z.literal('person'),schemaVersion:z.literal(1),aliases:z.array(text(240)).max(20).describe('Distinct aliases ignoring case; blank aliases normalize away.'),phone:text(80).nullable(),email:text(254).nullable().describe('Email with one @ and no whitespace, or null.'),birthdayOn:optionalDate,birthdayMonthDay:z.string().regex(/^\d{2}-\d{2}$/).nullable().describe('Real MM-DD in Gregorian leap year 2000; cannot coexist with birthdayOn.'),company:text(240).nullable(),relationship:text(240).nullable(),links:completeRelations});
const schedule=z.xor([
 z.strictObject({kind:z.literal('all-day'),startDate:date,endDate:date.describe('Exclusive end date, later than startDate.')}),
 z.strictObject({kind:z.literal('timed'),startAt:instant,endAt:instant.describe('Later than startAt, with explicit offset matching timeZone.'),timeZone:zone}),
]);
const calendarBase={type:z.literal('calendar'),schemaVersion:z.literal(1),links:z.strictObject({project:pin.nullable(),domain:pin.nullable(),people:pins})};
const calendar=z.xor([
 z.strictObject({...calendarBase,calendarKind:z.literal('event'),schedule:schedule.nullable()}),
 z.strictObject({...calendarBase,calendarKind:z.literal('anniversary'),occasion:z.enum(['birthday','anniversary']),originOn:optionalDate,monthDay:z.string().regex(/^\d{2}-\d{2}$/).nullable().describe('Real MM-DD; cannot coexist with originOn and requires yearly repeat.'),calendarSystem:z.literal('gregorian'),repeat:z.enum(['none','yearly']),timeZone:zone}),
 z.strictObject({...calendarBase,calendarKind:z.literal('countdown'),targetOn:optionalDate,timeZone:zone}),
 z.strictObject({...calendarBase,calendarKind:z.literal('life-stage'),startOn:optionalDate,endOn:optionalDate.describe('Must not precede startOn.')}),
]);
const nonnegative=(max=Number.MAX_SAFE_INTEGER)=>z.number().min(0).max(max);
const quantity=(units:[string,...string[]],positive=false)=>z.strictObject({value:positive?z.number().positive().max(Number.MAX_SAFE_INTEGER):nonnegative(),unit:z.enum(units)}).nullable();
const healthBase={type:z.literal('health'),schemaVersion:z.literal(1),timeZone:zone,source:z.strictObject({kind:z.literal('manual'),label:text(240).nullable()})};
const health=z.xor([
 z.strictObject({...healthBase,healthKind:z.literal('body'),measuredAt:instant.nullable(),weight:quantity(['kg','lb'],true),bodyFatPercent:nonnegative(100).nullable(),circumference:z.strictObject(Object.fromEntries(circumferenceSites.map(site=>[site,quantity(['cm','in'],true)])))}),
 z.strictObject({...healthBase,healthKind:z.literal('sleep'),startedAt:instant.nullable(),endedAt:instant.nullable().describe('Later than startedAt when both are known.'),asleepMinutes:nonnegative().nullable().describe('Minutes, no more than the known elapsed interval.'),quality:z.enum(['poor','fair','good']).nullable()}),
 z.strictObject({...healthBase,healthKind:z.literal('training'),activity:z.enum(['strength','cardio','other']),state:z.enum(['planned','completed']),startedAt:instant.nullable(),durationMinutes:nonnegative().nullable().describe('Minutes or null.'),distance:quantity(['km','mi'])}),
]);
const record=(personal:z.ZodType,occurredOn:z.ZodType=optionalDate)=>z.strictObject({title:text(240,true),text:text(16384),occurredOn,personal});
const account=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/).meta({examples:['synthetic-account']});
const financeBase={amountMinor:z.number().int().min(1).max(1_000_000_000_000).describe('Positive integer minor units: CNY 分 (fen); 100 = CNY 1.00. No implicit conversion.'),currency:z.literal('CNY'),occurredOn:date,category:text(80,true).nullable(),notes:text(16384)};
export const financeFields=z.xor([
 z.strictObject({...financeBase,kind:z.literal('expense'),fromAccountRef:account.nullable(),toAccountRef:account.nullable(),originalEntryId:z.null()}),
 z.strictObject({...financeBase,kind:z.literal('income'),fromAccountRef:account.nullable(),toAccountRef:account.nullable(),originalEntryId:z.null()}),
 z.strictObject({...financeBase,kind:z.literal('refund'),fromAccountRef:account.nullable(),toAccountRef:account.nullable(),originalEntryId:recordId.describe('Existing original owner finance entry UUID; required for refund only.')}),
 z.strictObject({...financeBase,kind:z.literal('transfer'),fromAccountRef:account,toAccountRef:account.describe('Must differ from fromAccountRef.'),originalEntryId:z.null()}),
 z.strictObject({...financeBase,kind:z.literal('repayment'),fromAccountRef:account,toAccountRef:account.describe('Must differ from fromAccountRef.'),originalEntryId:z.null()}),
]) satisfies z.ZodType<FinanceDraft>;
export const baselineBinding=z.strictObject({baselineVersion:text(120,true),itemVersion:revision,digest}).nullable().describe('Exact binding returned by requirements GET/snapshot; null only for private UUID records.');
export function writeFieldsSchema(module:string,patch:boolean):z.ZodType{
 switch(module){
  case 'finance':return financeFields;
  case 'journal':return record(journal.nullable()).extend({text:text(16384,true)});
  case 'calendar':return record(calendar,z.null());
  case 'health':return record(health).describe('Complete manual health record; occurredOn must match measuredAt/startedAt in the selected zone when both are known.');
  case 'person':return record(person);
  case 'todo':{
   const base={title:text(240,true),notes:text(16384),dueOn:optionalDate,status:z.enum(['open','in_progress','done','cancelled']),personal:relations.nullable()};
   return patch?z.strictObject({...base,...planning}):z.strictObject({...base,notes:base.notes.optional(),dueOn:base.dueOn.optional(),status:base.status.optional(),personal:base.personal.optional(),...planning});
  }
  case 'requirements':return z.strictObject({title:text(240,true),body:text(16384),phaseId:z.string().regex(/^[a-z][a-z0-9-]{0,79}$/).meta({examples:['business']}),priority:z.enum(['P0','P1','P2','P3']),plannedStartOn:optionalDate,plannedEndOn:optionalDate,workflow:z.strictObject({state:z.enum(requirementWorkflowStates),purpose:text(4096),nextStep:text(4096)}).nullable().optional().describe('Omitted preserves saved workflow on PATCH; null clears. Does not change engineering or owner acceptance.')});
  case 'feedback':return z.strictObject({title:text(240,true).optional(),text:text(16384,true),sourceLabel:text(240,true).nullable().optional()});
  default:throw new Error('MCP_SCHEMA_UNSUPPORTED');
 }
}
export function organizationFieldsSchema(type:keyof typeof organizationPersonal,patch:boolean){
 const schema=record(organizationPersonal[type]);
 return patch?schema:schema.extend({text:text(16384).optional(),occurredOn:optionalDate.optional()});
}
export const classificationChanges=z.array(z.strictObject({todo:z.strictObject({id:recordId,sourceId:recordId,expectedRevision:revision}),before:completeRelations.nullable(),after:completeRelations})).min(1).max(100).describe('Distinct todo IDs; exact before/current source pins; native validator also enforces 128 KiB limit.');
