import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:https';
import * as tls from 'node:tls';
import {nativeFileNetwork} from '../src/file-handoff/source.ts';

test('native HTTPS verifies TLS, connects to the pinned address, omits credentials and does not follow redirects',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'lifeos-synthetic-file-tls-'));
 const trust=tls as unknown as {getCACertificates:(type:string)=>string[];setDefaultCACertificates:(certificates:string[])=>void};
 const original=trust.getCACertificates('default');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'synthetic-key.pem'),'-out',join(directory,'synthetic-cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});
 const cert=await readFile(join(directory,'synthetic-cert.pem'),'utf8'),requests:{path:string;authorization:unknown;cookie:unknown;encoding:unknown}[]=[];
 const bytes=Buffer.from('synthetic original over verified TLS\n');
 const server=createServer({key:await readFile(join(directory,'synthetic-key.pem')),cert},(request,response)=>{
  requests.push({path:request.url!,authorization:request.headers.authorization,cookie:request.headers.cookie,encoding:request.headers['accept-encoding']});
  if(request.url==='/stall')return;
  if(request.url==='/redirect'){response.writeHead(302,{location:'/must-not-follow'});response.end();return;}
  response.writeHead(200,{'content-type':'text/plain','content-length':bytes.length});response.end(bytes);
 });
 t.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));trust.setDefaultCACertificates(original);await rm(directory,{recursive:true,force:true});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='https://localhost:'+String((server.address() as {port:number}).port),pin={address:'127.0.0.1',family:4};
 // Test-only temporary trust changes this test process, never the OS or product policy.
 await assert.rejects(nativeFileNetwork.open(new URL(origin+'/file'),pin,AbortSignal.timeout(2000)),{code:'FILE_SOURCE_UNAVAILABLE'});
 trust.setDefaultCACertificates([...original,cert]);
 const received=await nativeFileNetwork.open(new URL(origin+'/file'),pin,AbortSignal.timeout(2000));
 const chunks=[];for await(const chunk of received.body)chunks.push(Buffer.from(chunk));received.close();
 assert.deepEqual(Buffer.concat(chunks),bytes);assert.equal(received.length,String(bytes.length));
 const redirected=await nativeFileNetwork.open(new URL(origin+'/redirect'),pin,AbortSignal.timeout(2000));assert.equal(redirected.status,302);redirected.close();
 await assert.rejects(nativeFileNetwork.open(new URL(origin+'/stall'),pin,AbortSignal.timeout(30)),{code:'FILE_SOURCE_UNAVAILABLE'});
 assert.equal(requests.some(request=>request.path==='/must-not-follow'),false);assert.ok(requests.every(request=>request.authorization===undefined&&request.cookie===undefined&&request.encoding==='identity'));
});
