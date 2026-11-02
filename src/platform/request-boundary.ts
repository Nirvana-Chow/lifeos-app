import{PlatformError}from'./domain.ts';
import{isHTTPSOrigin}from'./config.ts';
export function assertLocalRequest(request:Request,baseURL:string):void{
 const base=new URL(baseURL),url=new URL(request.url),h=request.headers;
 const localURL=url.origin===base.origin||(url.hostname==='localhost'&&url.protocol===base.protocol&&url.port===base.port);
 const forwardedHost=h.get('x-forwarded-host'),forwardedFor=h.get('x-forwarded-for'),forwardedProto=h.get('x-forwarded-proto'),forwardedPort=h.get('x-forwarded-port');
 const privateHTTPS=isHTTPSOrigin(base);
 const proxyURL=privateHTTPS&&(url.protocol==='http:'||url.protocol==='https:'&&forwardedPort==='443')&&['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='3002'&&forwardedHost===base.host&&forwardedProto==='https';
 const denied=h.get('host')!==base.host||h.has('forwarded')||(forwardedHost!==null&&forwardedHost!==base.host)||(forwardedProto!==null&&forwardedProto+':'!==base.protocol)||(forwardedPort!==null&&forwardedPort!==(base.port||(base.protocol==='https:'?'443':'80')));
 // HTTPS headers only validate a pinned origin, never identity or arbitrary URLs. The backend must remain loopback-only.
 if(denied||(privateHTTPS?!localURL&&!proxyURL:base.hostname!=='127.0.0.1'||!localURL||(forwardedFor!==null&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(forwardedFor))))throw new PlatformError(403,'ORIGIN_DENIED','此候选只接受已配置的访问来源。');
}
export async function readJSONBody(request:Request):Promise<unknown>{
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new PlatformError(415,'JSON_REQUIRED','需要 JSON 请求。');
 const reader=request.body?.getReader();if(!reader)throw new PlatformError(400,'INVALID_JSON','缺少请求内容。');
 let size=0;const chunks:Uint8Array[]=[];
 for(;;){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>131072){await reader.cancel().catch(()=>undefined);throw new PlatformError(413,'BODY_TOO_LARGE','请求过长。');}chunks.push(p.value);}
 const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new PlatformError(400,'INVALID_JSON','请求 JSON 无效。');}
}
