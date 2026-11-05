import {object,PlatformError} from '../platform/domain.ts';
import {normalizeMediaISBN,normalizeMediaPersonalFields,type MediaPersonalFields} from './domain.ts';
export type OpenLibrarySearchRequest={provider:'openlibrary';mode:'search'|'isbn';query:string;limit:number;url:string};
export type MediaMetadataCandidate={provider:'openlibrary';id:string;url:string;title:string;creators:string[];isbn:string|null};
const invalid=():never=>{throw new PlatformError(400,'INVALID_MEDIA_METADATA','请提供明确书名、关键词或有效 ISBN；一次最多查询20条公开作品资料。');};
/** Pure request adapter. No HTTP, account access, arbitrary host, shelf upload or background lookup. */
export function buildOpenLibrarySearchRequest(input:{query:string;mode?:'search'|'isbn';limit?:number}):OpenLibrarySearchRequest{
 const v=object(input,['query','mode','limit']),mode=v.mode??'search',limit=v.limit??5;if(typeof v.query!=='string'||!v.query.trim()||v.query.length>200||v.query.includes('\0')||!['search','isbn'].includes(mode as string)||typeof limit!=='number'||!Number.isInteger(limit)||limit<1||limit>20)return invalid();
 const query=mode==='isbn'?normalizeMediaISBN(v.query)!:v.query.trim(),url=new URL('https://openlibrary.org/search.json');url.searchParams.set(mode==='isbn'?'isbn':'q',query);url.searchParams.set('fields','key,title,author_name,isbn');url.searchParams.set('limit',String(limit));
 return{provider:'openlibrary',mode:mode as OpenLibrarySearchRequest['mode'],query,limit,url:url.href};
}
function record(value:unknown):Record<string,unknown>|null{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;}
/** Work results may contain many edition ISBNs. Only an explicitly requested, matching ISBN is retained. */
export function parseOpenLibrarySearchResponse(input:unknown,request?:OpenLibrarySearchRequest):MediaMetadataCandidate[]{
 const response=record(input);if(!response||!Array.isArray(response.docs)||response.docs.length>1000)return invalid();
 const explicit=request?buildOpenLibrarySearchRequest({query:request.query,mode:request.mode,limit:request.limit}):null,seen=new Set<string>(),result:MediaMetadataCandidate[]=[];
 for(const raw of response.docs.slice(0,explicit?.limit??20)){
  const doc=record(raw);if(!doc||typeof doc.key!=='string'||typeof doc.title!=='string'||!doc.title.trim()||doc.title.length>240||doc.title.includes('\0'))continue;
  const id=/^(?:\/works\/)?(OL\d+W)$/.exec(doc.key)?.[1];if(!id||seen.has(id))continue;
  if(doc.author_name!==undefined&&(!Array.isArray(doc.author_name)||doc.author_name.length>20||doc.author_name.some(value=>typeof value!=='string'||!value.trim()||value.length>240||value.includes('\0'))))continue;
  const creators=[...new Set((doc.author_name as string[]|undefined)?.map(value=>value.trim())??[])];
  let isbn:string|null=null;if(explicit?.mode==='isbn'&&Array.isArray(doc.isbn)&&doc.isbn.includes(explicit.query))isbn=explicit.query;
  seen.add(id);result.push({provider:'openlibrary',id,url:'https://openlibrary.org/works/'+id,title:doc.title.trim(),creators,isbn});
 }
 return result;
}
/** Invoke only after the owner selects a candidate. Personal state, notes, progress, dates and references stay intact. */
export function applyMediaMetadata(fields:MediaPersonalFields,candidate:MediaMetadataCandidate):MediaPersonalFields{
 const v=object(candidate,['provider','id','url','title','creators','isbn']);if(v.provider!=='openlibrary'||fields.personal.mediaKind!=='book')return invalid();
 for(const key of ['id','url','title','creators','isbn'])if(!Object.hasOwn(v,key)||v[key]===undefined)return invalid();
 return normalizeMediaPersonalFields({...fields,title:v.title,personal:{...fields.personal,creators:v.creators,isbn:v.isbn??fields.personal.isbn,external:{provider:v.provider,id:v.id,url:v.url}}});
}
