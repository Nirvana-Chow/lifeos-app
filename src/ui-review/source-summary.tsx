import type {WorkspaceData} from './contract';
/** Reads only the already validated snapshot, independently of filters and previews. */
export function SourceSummary({data}:{data:WorkspaceData}){
 const apple=data.tasks.filter(task=>task.sourceLabel==='Apple 提醒事项'),manual=data.tasks.filter(task=>task.sourceLabel==='手工录入'),other=data.tasks.length-apple.length-manual.length;
 const times=apple.map(task=>task.sourceCapturedAt).filter((value):value is string=>typeof value==='string'&&Number.isFinite(Date.parse(value))).sort((a,b)=>Date.parse(a)-Date.parse(b));
 const complete=data.coverage==='complete',missing=apple.length-times.length;
 return <section className="lo-source-summary" aria-label="待办来源与读取范围">
  <p>全部待办：<strong>{complete?data.tasks.length:'未知'}</strong> · {complete?'已验证完整快照':'仅当前已加载范围'}</p>
  <p>Apple 提醒事项：{complete?apple.length:'全量未知'} · 手工录入：{complete?manual.length:'全量未知'}{other>0&&<> · 其他 / 未知来源：{complete?other:'全量未知'}</>}</p>
  <p>Apple 原始读取时间：{times.length?<><time dateTime={times[0]}>{times[0]}</time>{times.at(-1)!==times[0]&&<> 至 <time dateTime={times.at(-1)}>{times.at(-1)}</time></>}{missing>0&&<>（另有 {missing} 项未提供）</>}</>:'未提供'}{!complete&&'（全量范围未知）'}</p>
  <p>网站快照读取：<time dateTime={data.asOf}>{data.asOf}</time></p>
  <p>Apple 导入内容是站内副本，非实时同步；本站修改不会写回 Apple。原始来源与记录 ID 保留。</p>
 </section>;
}
