import test from 'node:test';import assert from 'node:assert/strict';
test('file activation remains closed without a complete independent exact configuration',async()=>{
 const module=await import('../src/file-handoff/config.ts').catch(()=>null);assert.ok(module,'file runtime codec must exist');
 assert.equal(module.readFileHandoffConfig({}),null);
 assert.throws(()=>module.readFileHandoffConfig({LIFEOS_FILE_HANDOFF:'file-handoff-v1'}));
 assert.throws(()=>module.readFileHandoffConfig({LIFEOS_FILE_HANDOFF_DIRECTORY:'/tmp/file'}));
 const env={LIFEOS_FILE_HANDOFF:'file-handoff-v1',LIFEOS_FILE_HANDOFF_DIRECTORY:'/private/tmp/synthetic-files',LIFEOS_FILE_HANDOFF_ALLOWED_ORIGINS:'["https://synthetic-files.example.invalid"]'};
 assert.equal(module.readFileHandoffConfig(env)?.maxBytes,16*1024*1024);
 for(const change of [{LIFEOS_FILE_HANDOFF:'1'},{LIFEOS_FILE_HANDOFF_ALLOWED_ORIGINS:'[]'},{LIFEOS_FILE_HANDOFF_ALLOWED_ORIGINS:'["http://localhost"]'},{LIFEOS_FILE_HANDOFF_MAX_BYTES:'33554433'}])assert.throws(()=>module.readFileHandoffConfig({...env,...change}));
});
