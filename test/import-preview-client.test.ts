import test from 'node:test';import assert from 'node:assert/strict';
import {parsePreview,requestPreview} from '../src/import-preview/client.ts';
const valid={format:'lifeos.import-preview.v1',counts:{candidate:0,duplicate:0,conflict:0,invalid:0},items:[],writesPerformed:0,importAvailable:false,historyCount:0,extensionsIncluded:false,restorationVerified:false};
test('preview client validates counts and no-write invariant before rendering a result',()=>{
 assert.deepEqual(parsePreview(valid),valid);
 for(const change of [{writesPerformed:1},{importAvailable:true},{restorationVerified:true},{counts:{candidate:1,duplicate:0,conflict:0,invalid:0}},{items:[{index:3,status:'candidate',id:'x',kind:'todo',title:'test',issues:[]}]}])assert.throws(()=>parsePreview({...valid,...change}));
});
test('preview client rejects unexpected count keys before they can reach the summary',()=>{
 for(const extra of [1,'synthetic-private-count',{nested:'synthetic-private-count'}])assert.throws(()=>parsePreview({...valid,counts:{...valid.counts,unexpected:extra}}));
});
test('preview sends only explicit synthetic document to the fixed same-origin endpoint',async()=>{
 const requests:{url:unknown;options:RequestInit|undefined}[]=[];
 const transport:typeof fetch=async(url,options)=>{requests.push({url,options});return Response.json({preview:valid});};
 await requestPreview('{"format":"lifeos.review.export.v2"}',transport);
 assert.equal(requests.length,1);assert.equal(requests[0].url,'/api/platform/import/preview');assert.equal(requests[0].options?.credentials,'same-origin');assert.equal(requests[0].options?.cache,'no-store');
 assert.deepEqual(JSON.parse(String(requests[0].options?.body)),{document:{format:'lifeos.review.export.v2'},syntheticOnly:true});
 await assert.rejects(()=>requestPreview('{invalid',transport));await assert.rejects(()=>requestPreview('x'.repeat(110001),transport));assert.equal(requests.length,1);
});
test('preview errors never echo server-private messages or imply an import',async()=>{
 for(const status of [400,401,403,413,503])await assert.rejects(()=>requestPreview('{}',async()=>Response.json({error:{message:'fixture-server-secret'}},{status})),error=>error instanceof Error&&!error.message.includes('fixture-server-secret'));
 await assert.rejects(()=>requestPreview('{}',async()=>Response.json({preview:{...valid,writesPerformed:1}})));
});
for(const [failure,transport]of [
 ['malformed successful response',async()=>new Response('PRIV8',{status:200})],
 ['transport failure',async()=>{throw Error('PRIV8 synthetic transport message');}],
 ['body read failure',async()=>({ok:true,json:async()=>{throw Error('PRIV8 synthetic body-reader message');}} as unknown as Response)],
] as const)test(`${failure} never exposes its original error`,async()=>{
 await assert.rejects(()=>requestPreview('{}',transport),error=>error instanceof Error&&!error.message.includes('PRIV8'));
});
