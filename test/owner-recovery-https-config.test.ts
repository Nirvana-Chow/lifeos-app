import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixtureCaddyfile} from './helpers/owner-recovery-https-config.ts';
const source=readFileSync('test/fixtures/Caddyfile.synthetic','utf8');
test('synthetic Caddy projection binds exact anonymous source with loopback TLS and closed fallback',()=>{
 const value=fixtureCaddyfile(source,'/fixture/server.crt','/fixture/server.key');
 assert.match(value,/https:\/\/review\.example\.test:14443 \{\n bind 127\.0\.0\.1\n tls \/fixture\/server.crt \/fixture\/server.key/);
 assert.match(value,/header_up -Forwarded/);assert.match(value,/header_up -X-Platform-Client/);assert.match(value,/respond "Not Found" 404/);assert.doesNotMatch(value,/review\/admin|file_server|staticReview/);
});
test('synthetic Caddy rejects changed routes headers upstreams and arbitrary paths',()=>{
 for(const candidate of [source+'\n',source.replace('/login','/review/admin'),source.replace('3002','4000'),source.replace('header_up -Forwarded','header_up Forwarded attacker')])assert.throws(()=>fixtureCaddyfile(candidate,'/fixture/server.crt','/fixture/server.key'),/Reviewed synthetic Caddy configuration changed/);
 for(const path of ['/fixture/server.crt\nrespond x','relative','/fixture/key"'])assert.throws(()=>fixtureCaddyfile(source,path,'/fixture/server.key'),/Invalid fixture TLS paths/);
});
