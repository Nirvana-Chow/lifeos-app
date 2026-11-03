import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
/** Only the committed anonymous fixture may become a loopback TLS listener. */
export function fixtureCaddyfile(source:string,certificate:string,key:string):string {
 if(!/^\/[A-Za-z0-9_./-]+$/.test(certificate)||!/^\/[A-Za-z0-9_./-]+$/.test(key))throw Error('Invalid fixture TLS paths');
 if(createHash('sha256').update(source).digest('hex')!=='1f53a1f63c14edd12ac90024cc468b3d16afc556a641598818d0b753b15af177')throw Error('Reviewed synthetic Caddy configuration changed');
 return source.replace('review.example.test {',`https://review.example.test:14443 {\n bind 127.0.0.1\n tls ${certificate} ${key}`);
}
/** Force Node's single-address callback mode while retaining fixed SNI and CA. */
export const fixtureLookup={family:4 as const,lookup:(_host:string,_options:unknown,callback:(error:NodeJS.ErrnoException|null,address:string,family:number)=>void)=>callback(null,'127.0.0.1',4)};
export function fixtureErrorCode(error:unknown):string{const code=(error as NodeJS.ErrnoException)?.code;return typeof code==='string'&&/^[A-Z0-9_]{1,64}$/.test(code)?code:'UNKNOWN';}

/** Shared RSC request path for the real TLS probe and native validation regression. */
export async function fixtureRscPath():Promise<string>{
 const {setCacheBustingSearchParam}=createRequire(import.meta.url)('next/dist/client/components/router-reducer/set-cache-busting-search-param.js');
 const url=new URL('https://review.example.test/personal');await setCacheBustingSearchParam(url,{rsc:'1'});return url.pathname+url.search;
}

/** Preserve the synthetic TLS wire response for native auth and cache assertions. */
export function fixtureWireResponse(bytes:Uint8Array,rawHeaders:readonly string[],status:number):Response{
 const headers=new Headers();for(let i=0;i<rawHeaders.length;i+=2)headers.append(rawHeaders[i],rawHeaders[i+1]);
 return new Response(Uint8Array.from(bytes),{status,headers});
}
