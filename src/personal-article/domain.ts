import {validateCalendarDate} from '../calendar-candidate/domain.ts';
import {object,PlatformError} from '../platform/domain.ts';

export const articleAttributions=['original','excerpt','summary'] as const;
export const articleAttributionLabels={original:'原创',excerpt:'摘录',summary:'摘要'};
export type ArticlePersonal={
  type:'article';
  schemaVersion:1;
  author:string|null;
  attribution:typeof articleAttributions[number];
  sourceURL:string|null;
};
export type ArticleFields={title:string;text:string;occurredOn:string|null;personal:ArticlePersonal};

function invalid(message:string):never {
  throw new PlatformError(400,'INVALID_ARTICLE_FIELDS',message);
}

function sourceAddress(input:unknown):string|null {
  if(input===null)return null;
  if(typeof input!=='string'||input.length>2048||/[\u0000-\u001f\u007f]/.test(input))return invalid('原文链接格式无效或过长。');
  const value=input.trim();
  if(!value)return null;
  if(!/^https?:\/\/[^/]/i.test(value)||/[\u0020\\]/.test(value))return invalid('请填写完整的 HTTP 或 HTTPS 原文链接。');
  let parsed:URL;
  try{parsed=new URL(value);}catch{return invalid('请核对原文链接。');}
  if(!parsed.hostname||parsed.username||parsed.password)return invalid('原文链接需要有效地址且不得包含登录信息。');
  return value;
}

export function validateArticlePersonal(input:unknown):ArticlePersonal {
  const value=object(input,['type','schemaVersion','author','attribution','sourceURL']);
  if(value.type!=='article'||value.schemaVersion!==1)return invalid('文章字段版本无效。');
  const {author,attribution}=value;
  if(author!==null&&(typeof author!=='string'||author.length>240||/[\u0000-\u001f\u007f]/.test(author)))return invalid('作者姓名格式无效或过长。');
  if(!articleAttributions.some(option=>option===attribution))return invalid('请选择原创、摘录或摘要。');
  const authorName=typeof author==='string'?author.trim()||null:null;
  const sourceURL=sourceAddress(value.sourceURL);
  if(!authorName&&!sourceURL)return invalid('请至少填写作者或原文链接。');
  return{type:'article',schemaVersion:1,author:authorName,attribution:attribution as ArticlePersonal['attribution'],sourceURL};
}

export function normalizeArticleFields(input:unknown):ArticleFields {
  const value=object(input,['title','text','occurredOn','personal']);
  const {title,text}=value;
  if(typeof title!=='string'||!title.trim()||title.length>240||title.includes('\0'))return invalid('请填写有效的文章标题。');
  if(typeof text!=='string'||!text.trim()||text.length>16384||text.includes('\0'))return invalid('请填写文章正文，最多 16,384 字。');
  return{title:title.trim(),text,occurredOn:value.occurredOn===null?null:validateCalendarDate(value.occurredOn),personal:validateArticlePersonal(value.personal)};
}
