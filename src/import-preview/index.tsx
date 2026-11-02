'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {requestPreview} from './client';
import type {ImportPreview} from './preview';
import s from './styles.module.css';
const labels={candidate:'可候选',duplicate:'重复',conflict:'待核对',invalid:'不通过'};
export function ImportPreviewPanel(){
 const [text,setText]=useState(''),[preview,setPreview]=useState<ImportPreview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false);
 const generation=useRef(0);useEffect(()=>()=>{generation.current++;},[]);
 const change=(next:string)=>{generation.current++;setText(next);setPreview(null);setError('');setBusy(false);};
 async function submit(event:FormEvent){event.preventDefault();if(!confirmed)return;const version=++generation.current;setBusy(true);setPreview(null);setError('');try{const value=await requestPreview(text);if(version===generation.current)setPreview(value);}catch(e){if(version===generation.current)setError(e instanceof Error?e.message:'预览失败。');}finally{if(version===generation.current)setBusy(false);}}
 return <section className={s.panel}><div className={s.heading}><h2>导入预览</h2><span>不写入数据库</span></div>
  <p>本轮仅核对虚构测试 JSON。真实资料导入尚未开放。</p>
  <form onSubmit={submit}><label htmlFor="import-document">粘贴测试导出</label><textarea id="import-document" value={text} onChange={e=>change(e.target.value)} rows={10} spellCheck={false} autoComplete="off" placeholder="lifeos.review.export.v2"/>
   <label className={s.check}><input type="checkbox" checked={confirmed} onChange={e=>{generation.current++;setConfirmed(e.target.checked);setPreview(null);setBusy(false);}}/>我确认仅包含虚构测试内容，不含私人资料或密钥</label>
   <div className={s.actions}><button type="submit" disabled={busy||!confirmed||!text.trim()}>{busy?'核对中…':'检查字段与重复'}</button><button type="button" onClick={()=>change('')} disabled={!text}>清空</button><a href="/api/platform/export" download>导出当前隔离测试空间</a></div>
  </form>{error&&<p role="alert" className={s.error}>{error}</p>}
  {preview&&<div aria-live="polite"><div className={s.counts}>{(Object.keys(labels) as (keyof typeof labels)[]).map(key=><span key={key}>{labels[key]} {preview.counts[key]}</span>)}</div>
   {!preview.items.length?<p>文件没有当前记录。</p>:<ul className={s.list}>{preview.items.map(row=><li key={row.index}><div><strong>{row.title||`第 ${row.index+1} 条`}</strong><span>{labels[row.status]}</span></div>{row.issues.map(issue=><p key={issue}>{issue}</p>)}</li>)}</ul>}
   <p>已核对 {preview.historyCount} 条历史的格式边界；未恢复历史或日历附件。预览没有保存任何记录，导入执行仍待实现与授权。</p>
  </div>}
  <details><summary>范围与限制</summary><p>每批最多 100 条当前记录、500 条历史和 110 KB 文本。只处理本系统隔离测试导出；不读取磁盘、不抓取网址、不自动合并冲突。导出与预览都不代表备份恢复通过。</p></details>
 </section>;
}
