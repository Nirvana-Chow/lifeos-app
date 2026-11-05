'use client';
import type {PublicEntry} from '../platform/contracts';
import {RelationFields} from '../personal-candidate/relation-fields';
import {mediaKinds,mediaStates,mediaProviders,type MediaPersonal,type MediaKind} from './domain';
import {mediaKindLabels,mediaStateLabels} from './projection';
import styles from './media.module.css';
const providerLabels={manual:'手动来源',openlibrary:'Open Library（书籍资料）',tmdb:'TMDB（手动链接）',imdb:'IMDb（手动链接）',douban:'豆瓣（手动链接）'};
const numeric=(value:string)=>value===''?null:Number(value);
export function MediaFields({value,onChange,options,disabled=false}:{value:MediaPersonal;onChange:(value:MediaPersonal)=>void;options:Record<string,PublicEntry[]>;disabled?:boolean}){
 function changeKind(kind:MediaKind){const progress=value.progress.unit==='percent'?value.progress:{current:null,total:null,unit:null};onChange({...value,mediaKind:kind,isbn:kind==='book'?value.isbn:null,progress,external:value.external.provider==='manual'||value.external.provider==='douban'?value.external:{provider:'manual',id:null,url:null}});}
 return <fieldset disabled={disabled} className={styles.fields}>
  <legend>阅读 / 观影</legend>
  <div className={styles.grid}>
   <label>作品类型<select name="mediaKind" value={value.mediaKind} onChange={event=>changeKind(event.target.value as MediaKind)}>{mediaKinds.map(kind=><option key={kind} value={kind}>{mediaKindLabels[kind]}</option>)}</select></label>
   <label>阅读 / 观看状态<select name="mediaState" value={value.state} onChange={event=>onChange({...value,state:event.target.value as MediaPersonal['state']})}>{mediaStates.map(state=><option key={state} value={state}>{mediaStateLabels[state]}</option>)}</select></label>
  </div>
  <label>{value.mediaKind==='book'?'作者':'导演 / 创作者'}（每行一位）<textarea name="mediaCreators" rows={2} maxLength={4820} value={value.creators.join('\n')} onChange={event=>onChange({...value,creators:event.target.value.split('\n')})}/></label>
  <div className={styles.grid}>
   <label>开始日期<input name="mediaStartedOn" type="date" value={value.startedOn??''} onChange={event=>onChange({...value,startedOn:event.target.value||null})}/></label>
   <label>完成日期<input name="mediaFinishedOn" type="date" value={value.finishedOn??''} onChange={event=>onChange({...value,finishedOn:event.target.value||null})}/></label>
  </div>
  <details><summary>进度与个人评分</summary><div className={styles.detailBody}>
   <label>进度单位<select name="mediaProgressUnit" value={value.progress.unit??''} onChange={event=>{const unit=(event.target.value||null) as MediaPersonal['progress']['unit'];onChange({...value,progress:unit===value.progress.unit?value.progress:{unit,current:null,total:null}});}}><option value="">未知 / 暂不记录</option>{value.mediaKind==='book'&&<option value="page">页</option>}{value.mediaKind==='series'&&<option value="episode">集</option>}<option value="percent">百分比</option></select></label>
   {value.progress.unit!==null&&<div className={styles.grid}>
    <label>当前进度<input name="mediaProgressCurrent" type="number" min={0} max={value.progress.unit==='percent'?100:10000000} step={value.progress.unit==='percent'?'any':1} inputMode="decimal" value={value.progress.current??''} onChange={event=>onChange({...value,progress:{...value.progress,current:numeric(event.target.value)}})}/></label>
    <label>总量<input name="mediaProgressTotal" type="number" min={1} max={value.progress.unit==='percent'?100:10000000} step={1} inputMode="numeric" value={value.progress.total??''} placeholder={value.progress.unit==='percent'?'100 或留空':'未知可留空'} onChange={event=>onChange({...value,progress:{...value.progress,total:numeric(event.target.value)}})}/></label>
   </div>}
   <label>个人评分（0–10，可留空）<input name="mediaRating" type="number" min={0} max={10} step="any" inputMode="decimal" value={value.rating??''} onChange={event=>onChange({...value,rating:numeric(event.target.value)})}/></label>
   <p className={styles.hint}>未知请留空。进度、日期与评分分别保存，填满进度不会自动标记完成。</p>
  </div></details>
  <details><summary>作品来源与关联</summary><div className={styles.detailBody}>
   {value.mediaKind==='book'&&<label>ISBN<input name="mediaISBN" maxLength={40} inputMode="text" value={value.isbn??''} onChange={event=>onChange({...value,isbn:event.target.value||null})}/></label>}
   <label>资料来源<select name="mediaProvider" value={value.external.provider} onChange={event=>onChange({...value,external:{provider:event.target.value as MediaPersonal['external']['provider'],id:null,url:null}})}>{mediaProviders.filter(provider=>provider==='manual'||provider==='douban'||(value.mediaKind==='book'?provider==='openlibrary':provider==='tmdb'||provider==='imdb')).map(provider=><option key={provider} value={provider}>{providerLabels[provider]}</option>)}</select></label>
   <label>来源标识<input name="mediaExternalId" maxLength={120} value={value.external.id??''} onChange={event=>onChange({...value,external:{...value.external,id:event.target.value||null}})}/></label>
   <label>作品来源网址<input name="mediaExternalURL" type="url" maxLength={2048} value={value.external.url??''} onChange={event=>onChange({...value,external:{...value.external,url:event.target.value||null}})}/></label>
   <p className={styles.hint}>来源链接用于保留出处。当前不会自动读取第三方账号或同步已读、已看记录。</p>
   <RelationFields value={value.links} options={options} onChange={links=>onChange({...value,links})}/>
  </div></details>
 </fieldset>;
}
