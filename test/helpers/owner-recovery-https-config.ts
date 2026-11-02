import {createRequire} from 'node:module';
/** Build an isolated listener from the reviewed private-site block; fail on drift. */
export function fixtureCaddyfile(source:string,certificate:string,key:string):string {
 if(!/^\/[A-Za-z0-9_./-]+$/.test(certificate)||!/^\/[A-Za-z0-9_./-]+$/.test(key))throw Error('Invalid fixture TLS paths');
 const commonStart=source.indexOf('(common) {'),publicStart=source.indexOf('(public) {'),siteStart=source.indexOf('lifeos.example.invalid {');
 const required=[' @app path /login /account/* /personal /personal/* /_next/* /api/platform /api/platform/*','reverse_proxy 127.0.0.1:3002','header_up Host lifeos.example.invalid','header_up X-Forwarded-Host lifeos.example.invalid','header_up X-Forwarded-Proto https','header_up X-Forwarded-Port 443','header_up -Forwarded','header_up -X-Platform-Client'];
 if(source.slice(0,commonStart)!=='{\n admin off\n servers {\n  strict_sni_host on\n }\n}\n'||commonStart<0||publicStart<commonStart||siteStart<publicStart||required.some(v=>!source.slice(siteStart).includes(v)))throw Error('Reviewed Caddy configuration changed');
 const common=source.slice(commonStart,publicStart),site=source.slice(siteStart).replaceAll('lifeos.example.invalid','review.example.test').replace('review.example.test {',`https://review.example.test:14443 {\n bind 127.0.0.1\n tls ${certificate} ${key}`);
 return source.slice(0,commonStart)+common+site;
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
