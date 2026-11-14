import {z} from 'zod';
import {checksumSchema} from './public.ts';

export const fileScopes=['file-handoff:read','file-handoff:write'] as const;
const validScopes=(scopes:readonly string[])=>new Set(scopes).size===scopes.length&&(!scopes.includes('file-handoff:write')||scopes.includes('file-handoff:read'));
export const filePermissionStateSchema=z.strictObject({version:z.literal('file-handoff-v1'),revision:z.number().int().positive(),digest:checksumSchema,scopes:z.array(z.enum(fileScopes)).max(2),consumer:z.enum(['codex']).nullable()}).refine(value=>validScopes(value.scopes)&&(value.scopes.length>0||value.consumer===null));
export const filePermissionSchema=filePermissionStateSchema.refine(value=>value.scopes.includes('file-handoff:read'));
export type FilePermission=z.infer<typeof filePermissionSchema>;
export const filePermissionChangeSchema=z.strictObject({id:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),version:z.literal('file-handoff-v1'),expectedGrantDigest:checksumSchema,expectedFileRevision:z.number().int().min(0),scopes:z.array(z.enum(fileScopes)).max(2),consumer:z.enum(['codex']).nullable()}).refine(value=>validScopes(value.scopes)&&(value.scopes.length>0||value.consumer===null));
export type FilePermissionChange=z.infer<typeof filePermissionChangeSchema>;
