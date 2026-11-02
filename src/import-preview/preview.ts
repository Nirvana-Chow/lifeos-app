import {inspectSnapshotCompatibility,assertReadableEntries} from '../platform/data-compatibility.ts';
import {PlatformError,object,validateTodo,validateFinance,validateInbox,validateId,validateRevision} from '../platform/domain.ts';
import type {PublicEntry} from '../platform/contracts.ts';

export type PreviewStatus='candidate'|'duplicate'|'conflict'|'invalid';
export type PreviewRow={index:number;id:string|null;kind:string|null;title:string|null;status:PreviewStatus;issues:string[]};
export type ImportPreview={format:'lifeos.import-preview.v1';items:PreviewRow[];counts:Record<PreviewStatus,number>;writesPerformed:0;importAvailable:false;historyCount:number;extensionsIncluded:false;restorationVerified:false};
function fail(code:string,message:string):never{throw new PlatformError(400,code,message);}
const plain=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const canonical=(v:unknown):string=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':plain(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const allowedEnvelope=['dataCompatibility','format','scope','entries','history','extensions','exportedAt','requirementsVersion','snapshotConsistency','aiSecretsIncluded','backupOrRestoreVerified'];
const sensitive=/^(ownerId|password|passwordHash|apiKey|accessToken|refreshToken|privateKey|clientSecret|secretKey|sessionToken|idToken|authorization|cookie|credentials|secret|ciphertext|databaseURL)$/i;
function inspect(value:unknown,depth=0,budget={nodes:0}):void{
 if(depth>14||++budget.nodes>20_000)fail('PREVIEW_COMPLEXITY','文件层级或字段数量超过预览限制。');
 if(plain(value)){for(const [key,item]of Object.entries(value)){if(sensitive.test(key.replace(/[_\s-]/g,'')))fail('PREVIEW_PROTECTED_FIELD','内容含不支持的身份或秘密字段。');inspect(item,depth+1,budget);}}
 else if(Array.isArray(value))for(const item of value)inspect(item,depth+1,budget);
 else if(typeof value==='string'&&(value.includes('\0')||value.length>65_536))fail('PREVIEW_TEXT_LIMIT','文字过长或格式无效。');
 else if(typeof value==='number'&&!Number.isFinite(value))fail('PREVIEW_NUMBER','数值无效。');
 else if(value!==null&&!['string','number','boolean'].includes(typeof value))fail('PREVIEW_JSON','内容不是有效 JSON。');
}
const required=(o:Record<string,unknown>,keys:string[])=>{if(keys.some(k=>!Object.hasOwn(o,k)))fail('PREVIEW_MISSING','记录缺少明确字段。');};
function timestamp(value:unknown){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value)||!Number.isFinite(Date.parse(value)))fail('PREVIEW_TIMESTAMP','记录时间格式无效。');}
function entry(value:unknown):PublicEntry{
 inspect(value);
 const x=object(value,['id','kind','inboxId','draft','source','revision','createdAt','updatedAt','syncState','externalStatus']);
 required(x,['id','kind','draft','source','revision','createdAt','updatedAt','syncState','externalStatus']);
 validateId(x.id);validateRevision(x.revision);timestamp(x.createdAt);timestamp(x.updatedAt);
 if(!['todo','finance','inbox'].includes(String(x.kind))||x.syncState!=='draft'||x.externalStatus!==null)fail('PREVIEW_RECORD','只支持站内候选草稿记录。');
 const source=object(x.source,['id','system','externalId','version','asOf','original']);required(source,['id','system','externalId','version','asOf','original']);
 validateId(source.id);validateRevision(source.version);timestamp(source.asOf);
 if(source.system!=='website'||typeof source.externalId!=='string'||!source.externalId||source.externalId.length>240)fail('PREVIEW_SOURCE','来源标识无效。');
 if(!plain(x.draft))fail('PREVIEW_DRAFT','结构化字段无效。');
 required(x.draft,x.kind==='todo'?['title','notes','dueOn','status']:x.kind==='inbox'?['title','text','occurredOn','disposition']:['kind','amountMinor','currency','occurredOn','category','fromAccountRef','toAccountRef','originalEntryId','notes']);
 // Mutation validators may normalize fields; exact comparison must retain the submitted JSON.
 if(x.kind==='todo')validateTodo(x.draft);else if(x.kind==='inbox')validateInbox(x.draft);else validateFinance(x.draft);
 if(x.inboxId!==undefined){validateId(x.inboxId);if(x.kind!=='todo'||x.inboxId===x.id)fail('PREVIEW_LINK','收件箱关联无效。');}
 return x as PublicEntry;
}
const identity=(e:PublicEntry)=>`${e.source.system}:${e.source.externalId}`;
const overlap=(a:PublicEntry,b:PublicEntry)=>a.id===b.id||a.source.id===b.source.id||identity(a)===identity(b);
const same=(a:PublicEntry,b:PublicEntry)=>canonical(a)===canonical(b);

/** Read-only classification, not an import plan or restore guarantee. The caller supplies only owner-filtered existing rows. */
export function previewImport(document:unknown,existing:PublicEntry[]):ImportPreview{
 const doc=object(document,allowedEnvelope);
 if(doc.format!=='lifeos.review.export.v2'||doc.scope!=='isolated-synthetic')fail('PREVIEW_FORMAT','仅接受明确标识的隔离测试 JSON 导出。');
 if(!Array.isArray(doc.entries)||doc.entries.length>100||!Array.isArray(doc.history)||doc.history.length>500)fail('PREVIEW_LIMIT','每批最多 100 条当前记录和 500 条历史。');
 // Bound the whole payload before walking individual rows; per-row protected fields become visible validation failures.
 if(JSON.stringify(document).length>120_000)fail('PREVIEW_SIZE','导出内容超过本批预览限制，请缩小范围。');
 for(const [key,value]of Object.entries(doc))if(key!=='entries')inspect(value);
 if(doc.dataCompatibility!==undefined){const report=inspectSnapshotCompatibility(doc,(doc.dataCompatibility as any)?.targetReader);if(canonical(report)!==canonical(doc.dataCompatibility))fail('PREVIEW_COMPATIBILITY','兼容信息无法核对；不能用文件声明授权恢复或部署。');}
 for(const row of [...doc.entries,...doc.history]){if(plain(row)&&row.kind==='inbox'&&(plain(row.draft)&&Object.hasOwn(row.draft,'record')||plain(row.source)&&plain(row.source.original)&&Object.hasOwn(row.source.original,'record')))assertReadableEntries([row]);}
 if(doc.aiSecretsIncluded===true)fail('PREVIEW_PROTECTED_FIELD','不接受包含秘密的导出。');
 const parsed:(PublicEntry|null)[]=[],items:PreviewRow[]=doc.entries.map((value,index)=>{
  try{const e=entry(value);parsed.push(e);return{index,id:e.id,kind:e.kind,title:'title'in e.draft?e.draft.title:null,status:'candidate',issues:[]};}
  catch{parsed.push(null);return{index,id:null,kind:null,title:null,status:'invalid',issues:['字段、来源或身份内容无法通过校验']};}
 });
 const mark=(index:number,status:PreviewStatus,issue:string)=>{if(items[index].status==='invalid')return;items[index].status=status;if(!items[index].issues.includes(issue))items[index].issues.push(issue);};
 for(let i=0;i<parsed.length;i++){
  const e=parsed[i];if(!e)continue;
  const matches=existing.filter(old=>overlap(e,old));
  if(matches.length){if(matches.length===1&&same(e,matches[0]))mark(i,'duplicate','当前空间已存在相同记录');else mark(i,'conflict','相同 ID 或来源对应不同内容，需要人工核对');}
  for(let j=0;j<i;j++){
   const prior=parsed[j];if(!prior||!overlap(e,prior))continue;
   if(same(e,prior)&&items[j].status!=='conflict'){if(items[i].status==='candidate')mark(i,'duplicate','本批内容重复');}
   else{mark(i,'conflict','本批相同 ID 或来源存在不同内容');mark(j,'conflict','本批相同 ID 或来源存在不同内容');}
  }
 }
 const all=[...existing,...parsed.filter((e):e is PublicEntry=>e!==null)];
 for(let i=0;i<parsed.length;i++){
  const e=parsed[i];if(!e||items[i].status==='conflict')continue;
  const linked=e.kind==='finance'&&'kind'in e.draft&&e.draft.kind==='refund'?e.draft.originalEntryId:e.inboxId;
  if(!linked)continue;
  const targets=all.filter(target=>target.id===linked),target=targets[0];
  const valid=e.kind==='finance'?target?.kind==='finance'&&'kind'in target.draft&&target.draft.kind==='expense'&&target.draft.currency==='CNY':target?.kind==='inbox';
  const conflict=targets.some(t=>!same(t,target))||items.some((row,j)=>parsed[j]?.id===linked&&row.status==='conflict');
  if(!valid||conflict){items[i].status='invalid';items[i].issues.push('关联来源缺失、冲突或类型不相符');}
 }
 const counts={candidate:0,duplicate:0,conflict:0,invalid:0};for(const row of items)counts[row.status]++;
 return{format:'lifeos.import-preview.v1',items,counts,writesPerformed:0,importAvailable:false,historyCount:doc.history.length,extensionsIncluded:false,restorationVerified:false};
}
