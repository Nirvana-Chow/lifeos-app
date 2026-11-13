import {z} from 'zod';
import {stageFileSchema} from './public.ts';

const read=['file-handoff:read'] as const,write=['file-handoff:read','file-handoff:write'] as const;
/** Shared exact operation contract; activation and original-grant file permissions remain independently closed. */
export const fileHandoffOperations=[
 {id:'stageFileHandoff',method:'POST',path:'/v1/file-handoffs',module:'fileHandoff',policyClass:'explicit-file-handoff',requiredScopes:write,description:'Explicitly receive one real ChatGPT file into bounded authorized staging. Preserve the original command key; verify receipt by independent GET.'},
 {id:'getFileHandoff',method:'GET',path:'/v1/file-handoffs/{id}',module:'fileHandoff',policyClass:'explicit-file-handoff',requiredScopes:read,description:'Independently read current handoff metadata, checksum, bytes and acknowledgments by its original ID.'},
 {id:'downloadFileHandoff',method:'GET',path:'/v1/file-handoffs/{id}/content',module:'fileHandoff',policyClass:'explicit-file-handoff',requiredScopes:read,responseType:'binary',description:'Download actual verified original bytes through an authorized binary client; never serialize file contents as Base64 or pass them through a model.'},
 {id:'acknowledgeFileHandoff',method:'POST',path:'/v1/file-handoffs/{id}/acknowledgments',module:'fileHandoff',policyClass:'explicit-file-handoff',requiredScopes:write,description:'Record a trusted website/Codex consumer acknowledgment after it independently downloads and verifies SHA256 and bytes, with current revision and original command key.'},
] as const;
export const stageFileTool={
 name:'lifeos_stage_file',title:'Save an explicitly supplied file',
 description:'Use only when the owner explicitly asks to hand a real file to an authorized LifeOS requirement. Ordinary discussion, sandbox paths, library pages and text/Base64 are not file persistence. Keep the original idempotency key and independently get the returned ID.',
 inputSchema:z.toJSONSchema(stageFileSchema.extend({idempotencyKey:z.string().min(8).max(128)})),
 annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
 securitySchemes:[{type:'oauth2',scopes:write}],
 _meta:{'openai/fileParams':['file']},
} as const;
