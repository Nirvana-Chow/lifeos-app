import type {ImportPreview,PreviewStatus} from './preview.ts';
const statuses:PreviewStatus[]=['candidate','duplicate','conflict','invalid'];
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function parsePreview(value:unknown):ImportPreview{
 if(!plain(value)||value.format!=='lifeos.import-preview.v1'||value.writesPerformed!==0||value.importAvailable!==false||value.extensionsIncluded!==false||value.restorationVerified!==false||!Number.isSafeInteger(value.historyCount)||Number(value.historyCount)<0||!Array.isArray(value.items)||value.items.length>100||!plain(value.counts))throw Error('预览回执无法核对，请重试。');
 const totals={candidate:0,duplicate:0,conflict:0,invalid:0};
 for(const [index,row]of value.items.entries()){
  if(!plain(row)||row.index!==index||!statuses.includes(row.status as PreviewStatus)||!(row.id===null||typeof row.id==='string')||!(row.kind===null||['todo','finance','inbox'].includes(String(row.kind)))||!(row.title===null||typeof row.title==='string')||!Array.isArray(row.issues)||row.issues.some(x=>typeof x!=='string'))throw Error('预览条目无法核对，请重试。');
  totals[row.status as PreviewStatus]++;
 }
 const counts=value.counts;if(Object.keys(counts).length!==statuses.length||statuses.some(status=>counts[status]!==totals[status]))throw Error('预览统计不一致，请重试。');
 return value as ImportPreview;
}
export async function requestPreview(text:string,transport:typeof fetch=fetch):Promise<ImportPreview>{
 if(new TextEncoder().encode(text).byteLength>110_000)throw Error('每批文本最多 110 KB，请缩小测试导出范围。');
 let document:unknown;try{document=JSON.parse(text);}catch{throw Error('请粘贴有效 JSON。');}
 let response:Response;
 try{response=await transport('/api/platform/import/preview',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json'},body:JSON.stringify({document,syntheticOnly:true})});}
 catch{throw Error('无法取得预览回执，请重试。');}
 if(!response.ok)throw Error(response.status===401?'登录已失效，请重新登录。':response.status===403?'当前账号或来源不能进行预览。':response.status===503?'存储连接不可用，本次未生成预览。':'文件不能通过预览校验；请核对格式、条数和字段。');
 let result:unknown;try{result=await response.json();}catch{throw Error('预览回执无法核对，请重试。');}
 if(!plain(result))throw Error('预览回执无效。');return parsePreview(result.preview);
}
