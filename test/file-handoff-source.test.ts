import assert from 'node:assert/strict';
import test from 'node:test';

async function implementation(){
 const module=await import('../src/file-handoff/source.ts').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error;});
 assert.ok(module,'the pinned source downloader must exist');return module;
}
const origin='https://synthetic-files.example.invalid';
const body=async function*(){yield Buffer.from('synthetic');};
test('source download resolves once, pins a public address, streams bytes and closes the response',async()=>{
 const {PinnedFileSource}=await implementation();let lookups=0,closed=0;const connections:unknown[]=[];
 const source=new PinnedFileSource({allowedOrigins:[origin],maxBytes:16,timeoutMs:1000},{lookup:async()=>{lookups++;return[{address:'8.8.8.8',family:4}];},open:async(url,pin)=>{connections.push({origin:url.origin,pin});return{status:200,length:'9',mimeType:'text/plain',encoding:null,body:body(),close:()=>{closed++;}};}});
 const downloaded=await source.download(origin+'/file?temporary=synthetic');const all=[];for await(const chunk of downloaded.body)all.push(Buffer.from(chunk));
 downloaded.close();downloaded.close();assert.equal(Buffer.concat(all).toString(),'synthetic');assert.equal(lookups,1);assert.deepEqual(connections,[{origin,pin:{address:'8.8.8.8',family:4}}]);assert.equal(closed,1);
});
test('source allowlist is closed and rejects URL credentials, non-HTTPS, ports and lookalike origins before DNS',async()=>{
 const {PinnedFileSource}=await implementation();let lookedUp=0;
 const dependencies={lookup:async()=>{lookedUp++;return[{address:'8.8.8.8',family:4}];},open:async()=>{throw Error('unexpected connection');}};
 const source=new PinnedFileSource({allowedOrigins:[origin],maxBytes:16,timeoutMs:1000},dependencies);
 for(const url of ['sandbox:/mnt/data/file','http://synthetic-files.example.invalid/file','https://user:pass@synthetic-files.example.invalid/file',origin+':8443/file','https://synthetic-files.example.invalid.evil.invalid/file',origin+'/file#fragment'])await assert.rejects(source.download(url),{code:'FILE_SOURCE_DENIED'});
 await assert.rejects(new PinnedFileSource({allowedOrigins:[],maxBytes:16,timeoutMs:1000},dependencies).download(origin+'/file'),{code:'FILE_SOURCE_DENIED'});assert.equal(lookedUp,0);
});
test('private, mapped, special-use or mixed DNS answers never reach an HTTPS connection',async()=>{
 const {PinnedFileSource}=await implementation();let connections=0;
 for(const address of ['127.0.0.1','10.1.2.3','169.254.169.254','100.64.1.1','192.0.2.1','224.0.0.1','::1','::ffff:8.8.8.8','fc00::1','fe80::1','2001:db8::1','2002::1','3fff::1']){
  const source=new PinnedFileSource({allowedOrigins:[origin],maxBytes:16,timeoutMs:1000},{lookup:async()=>[{address:'8.8.8.8',family:4},{address,family:address.includes(':')?6:4}],open:async()=>{connections++;throw Error('unexpected connection');}});
  await assert.rejects(source.download(origin+'/file'),{code:'FILE_SOURCE_DNS_DENIED'});
 }
 assert.equal(connections,0);
});
test('redirects, excessive length, mismatched body length and stalled DNS remain unavailable',async()=>{
 const {PinnedFileSource}=await implementation();
 for(const [status,length,code] of [[302,'9','FILE_SOURCE_REDIRECT_DENIED'],[200,'99','FILE_TOO_LARGE'],[403,'9','FILE_SOURCE_UNAVAILABLE']] as const){
  let closed=0;const source=new PinnedFileSource({allowedOrigins:[origin],maxBytes:16,timeoutMs:1000},{lookup:async()=>[{address:'8.8.8.8',family:4}],open:async()=>({status,length,mimeType:null,encoding:null,body:body(),close:()=>{closed++;}})});
  await assert.rejects(source.download(origin+'/file'),{code});assert.equal(closed,1);
 }
 const truncated=new PinnedFileSource({allowedOrigins:[origin],maxBytes:16,timeoutMs:1000},{lookup:async()=>[{address:'8.8.8.8',family:4}],open:async()=>({status:200,length:'10',mimeType:null,encoding:null,body:body(),close:()=>{}})});
 const download=await truncated.download(origin+'/file');await assert.rejects(async()=>{for await(const _ of download.body){}},{code:'FILE_SOURCE_TRUNCATED'});
 const stalled=new PinnedFileSource({allowedOrigins:[origin],maxBytes:16,timeoutMs:20},{lookup:async()=>new Promise(()=>{}),open:async()=>{throw Error('unexpected');}});
 await assert.rejects(stalled.download(origin+'/file'),{code:'FILE_SOURCE_TIMEOUT'});
});
