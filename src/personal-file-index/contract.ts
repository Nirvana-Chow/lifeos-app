import {z} from 'zod';

export const fileIndexPath = '/api/platform/personal/files';
const id = z.uuid().transform(value => value.toLowerCase());
const revision = z.number().int().min(1).max(2147483647);
const label = z.string().trim().min(1).max(240).regex(/^[^\u0000-\u001f\u007f]+$/u);
export const indexLimit = 80;
export const projectPinSchema = z.strictObject({id, sourceId: id, revision});
const locationSchema = z.discriminatedUnion('state', [
  z.strictObject({state: z.literal('unverified'), label: label.nullable()}),
  z.strictObject({state: z.literal('example'), label}),
  z.strictObject({state: z.literal('verified'), label, verifiedAt: z.iso.datetime()}),
]);
const metadataFields = {id, sourceId: id, revision, title: label, location: locationSchema};
export const manifestSchema = z.strictObject({
  version: z.literal(1),
  ownerId: label,
  spaceId: label,
  entries: z.array(z.strictObject({...metadataFields, project: projectPinSchema.nullable()})).max(indexLimit),
}).refine(value => new Set(value.entries.map(row => row.id)).size === value.entries.length &&
  new Set(value.entries.map(row => row.sourceId)).size === value.entries.length);
const projectSchema = z.discriminatedUnion('state', [
  z.strictObject({state: z.enum(['unlinked', 'unavailable', 'changed'])}),
  z.strictObject({state: z.literal('current'), pin: projectPinSchema, title: label}),
]);
const rowSchema = z.strictObject({...metadataFields, project: projectSchema});
export const indexResponseSchema = z.discriminatedUnion('state', [
  z.strictObject({state: z.literal('unconnected')}),
  z.strictObject({state: z.literal('ready'), rows: z.array(rowSchema).max(indexLimit)}),
]);
export const openResponseSchema = z.strictObject({file: projectPinSchema, project: projectPinSchema});
export type FileIndex = z.infer<typeof indexResponseSchema>;
export type FileIndexRow = z.infer<typeof rowSchema>;
export type ProjectPin = z.infer<typeof projectPinSchema>;

export function samePin(a: ProjectPin, b: ProjectPin) {
  return a.id === b.id && a.sourceId === b.sourceId && a.revision === b.revision;
}
