import {z} from 'zod';
import {absolutePathSchema,codePinSchema,digestSchema} from './private-files.ts';
export const assignmentSchema=z.strictObject({jobId:z.uuid(),requirementId:z.union([z.uuid(),z.string().regex(/^LO-[A-Z]+-\d{3}$/)]),sourceId:z.uuid(),workDigest:digestSchema,holderId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/),claimKey:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/),fence:z.number().int().positive().max(Number.MAX_SAFE_INTEGER)});
export const bridgeBindingSchema=z.strictObject({schemaVersion:z.literal(1),assignment:assignmentSchema,host:codePinSchema,jobDirectory:absolutePathSchema,clientEntry:codePinSchema,root:absolutePathSchema,manifestSHA256:digestSchema,gate:codePinSchema});
export const runtimeSchema=z.strictObject({host:codePinSchema,cli:codePinSchema,node:codePinSchema,bridge:z.strictObject({root:absolutePathSchema,entry:codePinSchema,manifest:codePinSchema,gate:codePinSchema}),client:z.strictObject({root:absolutePathSchema,entry:codePinSchema,manifest:codePinSchema,binary:codePinSchema}),worktree:absolutePathSchema,jobsDirectory:absolutePathSchema,assignmentsDirectory:absolutePathSchema,maxWallMs:z.number().int().min(100).max(1800000),maxOutputBytes:z.number().int().min(1024).max(1048576)});
export type WorkerRuntime=z.infer<typeof runtimeSchema>;
/** Root pins the exact reviewed summary bytes, backed by actual native effective
 * config/account projection and a no-business-data request. No approval boolean
 * or caller-selected egress grant exists. These receipts do not exist yet. */
export const providerSummarySchema=z.strictObject({schemaVersion:z.literal(1),cliSHA256:digestSchema,argvPolicySHA256:digestSchema,observedAt:z.number().int().positive(),expiresAt:z.number().int().positive(),effectiveConfig:codePinSchema,accountProjection:codePinSchema,smokeResult:codePinSchema});
