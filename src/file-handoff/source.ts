import {BlockList,isIP} from 'node:net';
import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {FileHandoffError,fail} from './contracts.ts';

type Address={address:string;family:number};
type SourceResponse={status:number;length:string|null;mimeType:string|null;encoding:string|null;body:AsyncIterable<Uint8Array>;close:()=>void};
type SourceNetwork={lookup:(hostname:string)=>Promise<Address[]>;open:(url:URL,address:Address,signal:AbortSignal)=>Promise<SourceResponse>};
const denied4=new BlockList(),denied6=new BlockList(),unicast6=new BlockList();
for(const [base,bits]of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const)denied4.addSubnet(base,bits,'ipv4');
unicast6.addSubnet('2000::',3,'ipv6');
for(const[base,bits]of [['2001::',23],['2001:db8::',32],['2002::',16],['3ffe::',16],['3fff::',20]] as const)denied6.addSubnet(base,bits,'ipv6');
function publicAddress(value:Address){const family=isIP(value.address);return !value.address.includes('%')&&family===value.family&&(family===4?!denied4.check(value.address,'ipv4'):family===6&&unicast6.check(value.address,'ipv6')&&!denied6.check(value.address,'ipv6'));}
async function bounded<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
 if(signal.aborted)fail(504,'FILE_SOURCE_TIMEOUT');
 let abort!:()=>void;
 try{return await Promise.race([work,new Promise<never>((_,reject)=>{abort=()=>reject(new FileHandoffError(504,'FILE_SOURCE_TIMEOUT'));signal.addEventListener('abort',abort,{once:true});})]);}
 finally{signal.removeEventListener('abort',abort);}
}
export const nativeFileNetwork:SourceNetwork={
 lookup:hostname=>lookup(hostname,{all:true,verbatim:true}),
 open:(url,address,signal)=>new Promise((resolve,reject)=>{
  const req=request(url,{method:'GET',agent:false,family:address.family,lookup:(_host,_options,done)=>done(null,address.address,address.family),servername:url.hostname,rejectUnauthorized:true,maxHeaderSize:16384,signal,headers:{accept:'application/octet-stream','accept-encoding':'identity'}},response=>resolve({status:response.statusCode??0,length:response.headers['content-length']??null,mimeType:response.headers['content-type']?.split(';')[0].trim()??null,encoding:response.headers['content-encoding']??null,body:response,close:()=>response.destroy()}));
  req.on('error',()=>reject(new FileHandoffError(503,'FILE_SOURCE_UNAVAILABLE')));req.end();
 }),
};
export class PinnedFileSource{
 private readonly origins:ReadonlySet<string>;
 private readonly options:{maxBytes:number;timeoutMs:number};
 private readonly network:SourceNetwork;
 constructor(options:{allowedOrigins:readonly string[];maxBytes:number;timeoutMs:number},network:SourceNetwork=nativeFileNetwork){
  if(!Number.isInteger(options.maxBytes)||options.maxBytes<1||options.maxBytes>32*1024*1024||!Number.isInteger(options.timeoutMs)||options.timeoutMs<1||options.timeoutMs>30000)fail(503,'FILE_SOURCE_CONFIG_INVALID');
  for(const origin of options.allowedOrigins){const url=new URL(origin);if(url.origin!==origin||url.protocol!=='https:'||url.port||url.username||url.password||isIP(url.hostname)||url.hostname.endsWith('.'))fail(503,'FILE_SOURCE_CONFIG_INVALID');}
  this.origins=new Set(options.allowedOrigins);this.options=options;this.network=network;
 }
 validateUrl(raw:string):URL{
  try{const url=new URL(raw);if(raw.length>8192||!this.origins.has(url.origin)||url.protocol!=='https:'||url.port||url.username||url.password||url.hash||isIP(url.hostname))throw Error();return url;}
  catch{return fail(400,'FILE_SOURCE_DENIED');}
 }
 async download(raw:string,outer?:AbortSignal){
  const url=this.validateUrl(raw),signal=AbortSignal.any([AbortSignal.timeout(this.options.timeoutMs),...(outer?[outer]:[])]);
  let response:SourceResponse|undefined;
  try{
   const addresses=await bounded(this.network.lookup(url.hostname),signal);
   if(!addresses.length||addresses.length>32||!addresses.every(publicAddress))fail(400,'FILE_SOURCE_DNS_DENIED');
   response=await bounded(this.network.open(url,addresses[0],signal),signal);
   if(response.status>=300&&response.status<400)fail(400,'FILE_SOURCE_REDIRECT_DENIED');
   if(response.status!==200)fail(503,'FILE_SOURCE_UNAVAILABLE');
   const length=response.length===null?null:/^(?:0|[1-9]\d*)$/.test(response.length)?Number(response.length):NaN;
   if(length!==null&&(!Number.isSafeInteger(length)||length<0))fail(502,'FILE_SOURCE_INVALID');
   if(length!==null&&length>this.options.maxBytes)fail(413,'FILE_TOO_LARGE');
   if(response.encoding&&response.encoding!=='identity')fail(502,'FILE_SOURCE_ENCODING_DENIED');
   const current=response,max=this.options.maxBytes;let closed=false;const close=()=>{if(!closed){closed=true;current.close();}};
   const body=(async function*(){let bytes=0;const iterator=current.body[Symbol.asyncIterator]();
    try{for(;;){const item=await bounded(iterator.next(),signal);if(item.done)break;if(!(item.value instanceof Uint8Array))fail(502,'FILE_SOURCE_INVALID');bytes+=item.value.length;if(bytes>max)fail(413,'FILE_TOO_LARGE');yield item.value;}if(length!==null&&bytes!==length)fail(502,'FILE_SOURCE_TRUNCATED');}
    finally{close();}
   })();
   return{body,mimeType:response.mimeType,close};
  }catch(error){response?.close();if(error instanceof FileHandoffError)throw error;throw new FileHandoffError(503,'FILE_SOURCE_UNAVAILABLE');}
 }
}
