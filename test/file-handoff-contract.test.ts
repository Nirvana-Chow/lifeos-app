import assert from 'node:assert/strict';
import test from 'node:test';
import {stageFileTool,fileHandoffOperations} from '../src/file-handoff/operations.ts';
import {stageFileSchema} from '../src/file-handoff/contracts.ts';

test('the dedicated tool exposes official top-level file input without bytes, authority or nested file parameters',()=>{
 const schema=stageFileTool.inputSchema as any,file=schema.properties.file;
 assert.deepEqual(stageFileTool._meta['openai/fileParams'],['file']);
 assert.deepEqual(Object.keys(file.properties).sort(),['download_url','file_id','file_name','mime_type']);assert.deepEqual([...file.required].sort(),['download_url','file_id']);
 assert.deepEqual(Object.keys(schema.properties).sort(),['file','idempotencyKey','requirementId','retention']);assert.equal(stageFileTool.annotations.readOnlyHint,false);
 assert.deepEqual(stageFileTool.securitySchemes,[{type:'oauth2',scopes:['file-handoff:read','file-handoff:write']}]);
 assert.equal(stageFileSchema.safeParse({file:{download_url:'https://synthetic.invalid/file',file_id:'file_synthetic'},requirementId:'LO-FILES-001',retention:{kind:'retained'}}).success,true);
 assert.equal(fileHandoffOperations.find(operation=>operation.id==='downloadFileHandoff')?.responseType,'binary');
});
