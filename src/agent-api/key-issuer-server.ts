import {createServer} from 'node:http';
import {lstatSync} from 'node:fs';
import {dirname} from 'node:path';
import {readPrivateObject} from '../platform/private-config.ts';
import {createPostgresKeyIssuer,readKeyIssuerConfig,type KeyOperation} from './key-issuer.ts';

async function main() {
  if (process.argv.length!==3) throw Error('Private issuer configuration required');
  const config=readKeyIssuerConfig(readPrivateObject(process.argv[2]));
  const parent=lstatSync(dirname(config.socketPath));
  if (!parent.isDirectory() || parent.uid!==process.getuid?.() || (parent.mode&0o027)!==0 ||
      (parent.mode&0o700)!==0o700) throw Error('Protected issuer socket directory required');
  process.umask(0o117); // Unix socket is created with 0660, never world-accessible.
  const issuer=await createPostgresKeyIssuer(config);
  const routes=new Map<string,KeyOperation>([
    ['/v1/keys/list','list'], ['/v1/keys/create','create'], ['/v1/keys/revoke','revoke'], ['/v1/keys/setScopes','setScopes'],
    ['/v1/keys/setFileHandoff','setFileHandoff'],
  ]);
  const server=createServer({maxHeaderSize:16384,requestTimeout:5000},async (request,response)=>{
    response.setHeader('Cache-Control','private, no-store');
    response.setHeader('Vary','Cookie');
    response.setHeader('X-Content-Type-Options','nosniff');
    const send=(status:number,body?:unknown)=>{
      response.statusCode=status;
      if (body===undefined) response.end();
      else {response.setHeader('Content-Type','application/json; charset=utf-8');response.end(JSON.stringify(body));}
    };
    try {
      const operation=routes.get(request.url??'');
      if (!operation || request.method!=='POST' || request.headers.authorization!==undefined) return send(404,{error:'NOT_FOUND'});
      if (request.headers['content-type']!=='application/json') return send(415,{error:'JSON_REQUIRED'});
      const chunks:Buffer[]=[];
      let size=0;
      for await (const chunk of request) {
        size+=chunk.length;
        if (size>8192) {request.destroy();return;}
        chunks.push(chunk);
      }
      let body:unknown;
      try {body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
      catch {return send(400,{error:'INVALID_REQUEST'});}
      const result=await issuer.handle(operation,request.headers.cookie??'',body);
      send(result.status,result.body);
    } catch {
      if (!response.headersSent) send(503,{error:'KEY_MANAGEMENT_UNAVAILABLE'});
      else response.destroy();
    }
  });
  server.headersTimeout=5000;
  server.on('error',()=>{
    console.error('Private Agent key issuer unavailable.');
    void issuer.close().finally(()=>{process.exitCode=1;});
  });
  server.listen(config.socketPath);
  for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,()=>{
    server.close(()=>{void issuer.close();});
  });
}

main().catch(()=>{console.error('Private Agent key issuer unavailable.');process.exitCode=1;});
