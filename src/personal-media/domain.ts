import {object,PlatformError,validateId,validateRevision} from '../platform/domain.ts';
import {validateCalendarDate} from '../calendar-candidate/domain.ts';

export const mediaKinds=['book','film','series'] as const;
export const mediaStates=['wish','in_progress','completed','paused'] as const;
export const mediaProviders=['manual','openlibrary','tmdb','imdb','douban'] as const;
export type MediaKind=typeof mediaKinds[number];
export type MediaState=typeof mediaStates[number];
export type MediaReference={id:string;sourceId:string;revision:number};
export type MediaLinks={project:MediaReference|null;domain:MediaReference|null;topics:MediaReference[]};
export type MediaPersonal={
 type:'media';schemaVersion:1;mediaKind:MediaKind;state:MediaState;creators:string[];isbn:string|null;
 external:{provider:typeof mediaProviders[number];id:string|null;url:string|null};
 startedOn:string|null;finishedOn:string|null;rating:number|null;
 progress:{current:number|null;total:number|null;unit:'page'|'episode'|'percent'|null};links:MediaLinks;
};
export type PersonalMedia=MediaPersonal;
export type MediaPersonalFields={title:string;text:string;occurredOn:string|null;personal:MediaPersonal};
export type MediaFields=MediaPersonalFields;
const keys=['type','schemaVersion','mediaKind','state','creators','isbn','external','startedOn','finishedOn','rating','progress','links'] as const;
const invalid=(message='请核对作品资料、状态与进度。'):never=>{throw new PlatformError(400,'INVALID_MEDIA_FIELDS',message);};
function complete(value:unknown,allowed:readonly string[]):Record<string,unknown>{const v=object(value,allowed);if(allowed.some(key=>!Object.hasOwn(v,key)||v[key]===undefined))return invalid('请提交完整作品字段；未知资料请明确使用 null 或空数组。');return v;}
function nullableText(value:unknown,max:number):string|null{if(value===null)return null;if(typeof value!=='string'||value.length>max||value.includes('\0'))return invalid('作品资料过长或格式无效。');return value.trim()||null;}
function amount(value:unknown,max:number,integer=false):number|null{if(value===null)return null;if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>max||integer&&!Number.isInteger(value))return invalid('进度或评分超出允许范围。');return value;}
export function normalizeMediaISBN(value:unknown):string|null{
 const raw=nullableText(value,40);if(raw===null)return null;const isbn=raw.replace(/[\s-]/g,'').toUpperCase();
 if(/^\d{9}[\dX]$/.test(isbn)&&[...isbn].reduce((sum,n,i)=>sum+(n==='X'?10:Number(n))*(10-i),0)%11===0)return isbn;
 if(/^97[89]\d{10}$/.test(isbn)&&[...isbn].reduce((sum,n,i)=>sum+Number(n)*(i%2===0?1:3),0)%10===0)return isbn;
 return invalid('ISBN 需要有效的 ISBN-10 或 ISBN-13（含校验位）。');
}
function reference(value:unknown):MediaReference|null{if(value===null)return null;const v=complete(value,['id','sourceId','revision']);return{id:validateId(v.id),sourceId:validateId(v.sourceId),revision:validateRevision(v.revision)};}
function links(value:unknown):MediaLinks{const v=complete(value,['project','domain','topics']);if(!Array.isArray(v.topics)||v.topics.length>20)return invalid('关联主题最多20个。');const topics=v.topics.map(value=>reference(value)??invalid('主题引用无效。'));if(new Set(topics.map(pin=>pin.id)).size!==topics.length)return invalid('关联主题不能重复。');return{project:reference(v.project),domain:reference(v.domain),topics};}
function external(value:unknown,kind:MediaKind):MediaPersonal['external']{
 const v=complete(value,['provider','id','url']);if(!mediaProviders.includes(v.provider as any))return invalid('请选择支持的资料来源。');const provider=v.provider as MediaPersonal['external']['provider'],id=nullableText(v.id,120),url=nullableText(v.url,2048);
 if(provider==='openlibrary'&&kind!=='book'||(provider==='tmdb'||provider==='imdb')&&kind==='book')return invalid('资料来源与作品类型不一致。');
 const patterns={openlibrary:/^OL\d+[WM]$/,tmdb:/^\d+$/,imdb:/^tt\d+$/,douban:/^\d+$/};if(id&&provider!=='manual'&&!patterns[provider].test(id))return invalid('来源标识格式无效。');
 if(url){let parsed:URL;try{parsed=new URL(url);}catch{return invalid('请填写完整的作品来源网址。');}if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)return invalid('作品网址只接受无登录信息的 HTTP(S) 链接。');
  if(provider!=='manual'){
   if(parsed.protocol!=='https:'||parsed.port)return invalid('外部资料来源需要标准 HTTPS 链接。');
   const host=parsed.hostname,path=parsed.pathname;
   const match=provider==='openlibrary'?host==='openlibrary.org'&&/^\/(?:works\/(OL\d+W)|books\/(OL\d+M))(?:\/[^/]*)?\/?$/.exec(path):provider==='tmdb'?['www.themoviedb.org','themoviedb.org'].includes(host)&&new RegExp('^/'+(kind==='film'?'movie':'tv')+'/(\\d+)(?:-[^/]*)?/?$').exec(path):provider==='imdb'?['www.imdb.com','imdb.com'].includes(host)&&/^\/title\/(tt\d+)\/?$/.exec(path):(kind==='book'?['book.douban.com']:['movie.douban.com']).includes(host)&&/^\/subject\/(\d+)\/?$/.exec(path);
   if(!match||id&&!match.slice(1).includes(id))return invalid('来源网址与所选平台、作品类型或标识不一致。');
  }
 }
 return{provider,id,url};
}
export function emptyMediaPersonal(mediaKind:MediaKind='book'):MediaPersonal{return{type:'media',schemaVersion:1,mediaKind,state:'wish',creators:[],isbn:null,external:{provider:'manual',id:null,url:null},startedOn:null,finishedOn:null,rating:null,progress:{current:null,total:null,unit:null},links:{project:null,domain:null,topics:[]}};}
export function validateMediaPersonal(input:unknown):MediaPersonal{
 const v=complete(input,keys);if(v.type!=='media'||v.schemaVersion!==1||!mediaKinds.includes(v.mediaKind as MediaKind)||!mediaStates.includes(v.state as MediaState))return invalid();
 const kind=v.mediaKind as MediaKind;if(!Array.isArray(v.creators)||v.creators.length>20)return invalid('创作者最多20位。');const creators=v.creators.map(value=>typeof value==='string'?nullableText(value,240):invalid('创作者必须为文字。')).filter((value):value is string=>value!==null);if(new Set(creators.map(value=>value.toLocaleLowerCase())).size!==creators.length)return invalid('创作者不能重复。');
 const isbn=normalizeMediaISBN(v.isbn);if(isbn!==null&&kind!=='book')return invalid('只有书籍可以填写 ISBN。');
 const startedOn=v.startedOn===null?null:validateCalendarDate(v.startedOn),finishedOn=v.finishedOn===null?null:validateCalendarDate(v.finishedOn);if(startedOn&&finishedOn&&finishedOn<startedOn)return invalid('完成日期不能早于开始日期。');
 const p=complete(v.progress,['current','total','unit']);if(p.unit!==null&&!['page','episode','percent'].includes(p.unit as string))return invalid('请选择页、集或百分比进度。');
 if(p.unit==='page'&&kind!=='book'||p.unit==='episode'&&kind!=='series')return invalid('进度单位与作品类型不一致。');
 const current=amount(p.current,p.unit==='percent'?100:10_000_000,p.unit!=='percent'),total=amount(p.total,10_000_000,true);
 if(p.unit===null&&(current!==null||total!==null)||total!==null&&(total===0||current!==null&&current>total)||p.unit==='percent'&&total!==null&&total!==100)return invalid('进度需要明确单位，已完成量不能超过总量；百分比总量只可为100或未知。');
 return{type:'media',schemaVersion:1,mediaKind:kind,state:v.state as MediaState,creators,isbn,external:external(v.external,kind),startedOn,finishedOn,rating:amount(v.rating,10),progress:{current,total,unit:p.unit as MediaPersonal['progress']['unit']},links:links(v.links)};
}
export function normalizeMediaPersonalFields(input:unknown):MediaPersonalFields{
 const v=complete(input,['title','text','occurredOn','personal']),title=nullableText(v.title,240);if(!title)return invalid('请填写作品名称。');if(typeof v.text!=='string'||v.text.length>16384||v.text.includes('\0'))return invalid('作品笔记过长或无效。');return{title,text:v.text,occurredOn:v.occurredOn===null?null:validateCalendarDate(v.occurredOn),personal:validateMediaPersonal(v.personal)};
}
/** Ownership, target type and current-pin checks stay with PersonalService's single writer. */
export function mediaPersonalReferences(personal:MediaPersonal):{type:'project'|'domain'|'topic';link:MediaReference}[]{const r=personal.links;return[...(r.project?[{type:'project' as const,link:r.project}]:[]),...(r.domain?[{type:'domain' as const,link:r.domain}]:[]),...r.topics.map(link=>({type:'topic' as const,link}))];}
