import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {fileSqlFingerprints,fileTriggerFingerprints,fileNativeSessionFingerprint} from '../src/file-handoff/sql-fingerprints.ts';
test('file readiness pins the exact proposed grant and immutable-original function bodies',()=>{
 const digest=(source:string,namespace:string)=>Object.fromEntries([...source.matchAll(new RegExp('CREATE FUNCTION '+namespace+'\\.(\\w+)\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;','g'))].map(([,name,body])=>[name,createHash('sha256').update(body).digest('hex')]));
 assert.deepEqual(digest(readFileSync(new URL('../db/0023_file_handoff_permissions.proposed.sql',import.meta.url),'utf8'),'lifeos_agent'),Object.fromEntries(Object.entries(fileSqlFingerprints).map(([key,value])=>[key,value.digest])));
 assert.deepEqual(digest(readFileSync(new URL('../db/0022_file_handoff.proposed.sql',import.meta.url),'utf8'),'lifeos_platform'),fileTriggerFingerprints);
 assert.equal(digest(readFileSync(new URL('../db/0010_agent_key_management.proposed.sql',import.meta.url),'utf8'),'lifeos_agent').verify_management_session,fileNativeSessionFingerprint);
});
