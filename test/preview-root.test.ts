import test from 'node:test';import assert from 'node:assert/strict';import {resolve} from 'node:path';
test('dependency sharing widens only the explicit local preview resolution root',async()=>{
 const old=process.env.LIFEOS_PREVIEW_SHARED_DEPENDENCIES;
 try{
  delete process.env.LIFEOS_PREVIEW_SHARED_DEPENDENCIES;
  const normal=await import(new URL('../next.config.ts?fixture=normal',import.meta.url).href);assert.equal(normal.default.turbopack?.root,process.cwd());
  process.env.LIFEOS_PREVIEW_SHARED_DEPENDENCIES='1';
  const shared=await import(new URL('../next.config.ts?fixture=shared',import.meta.url).href);assert.equal(shared.default.turbopack?.root,resolve(process.cwd(),'..'));
 }finally{if(old===undefined)delete process.env.LIFEOS_PREVIEW_SHARED_DEPENDENCIES;else process.env.LIFEOS_PREVIEW_SHARED_DEPENDENCIES=old;}
});
