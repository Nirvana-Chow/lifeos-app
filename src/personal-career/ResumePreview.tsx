'use client';
import {useRef} from 'react';
import {printResumeArticle} from './print-resume';
import {careerKindLabels,careerSummary,projectResumeFacts,type CareerRecord} from './projection';
import s from './career.module.css';
/** Plain text only. No HTML injection, generated qualifications or unpinned fact fallback. */
export function ResumePreview({records,selected}:{records:readonly CareerRecord[];selected?:CareerRecord|null}){
 const printTarget=useRef<HTMLElement>(null);
 const resume=selected===undefined?records.find(row=>row.fields.personal.careerKind==='resume')??null:selected;
 if(!resume||resume.fields.personal.careerKind!=='resume')return <section className={s.preview} aria-label="简历预览"><h2>简历预览</h2><p>暂无简历版本。先保存经历事实，再建立简历版本并选择使用的事实。</p></section>;
 const result=projectResumeFacts(resume,records),p=resume.fields.personal;
 return <section className={s.preview} aria-label="简历预览"><div className={s.previewTools}><p className={s.hint}>按此版本关联的原事实生成；未填写的身份与联系方式不会补写。可使用浏览器打印。</p><button data-slot="personal-record-action" type="button" onClick={()=>{if(printTarget.current)printResumeArticle(printTarget.current,resume.fields.title);}}>打印此简历</button></div><article ref={printTarget} className={s.resume} data-career-print="true"><header><h1>{resume.fields.title}</h1>{p.targetRole?<p>{p.targetRole}</p>:null}</header>{resume.fields.text?<p className={s.prose}>{resume.fields.text}</p>:null}{result.unavailable.length?<p className={s.unavailable} role="status">{result.unavailable.length} 条事实引用已变更或未读到，预览已排除。请回到简历编辑核对引用。</p>:null}{result.facts.length?result.facts.map(fact=>{
 const meta=fact.fields.personal;if(!('highlights'in meta))return null;
 return <section className={s.resumeFact} key={fact.id}><h2>{fact.fields.title}</h2><p className={s.factType}>{careerKindLabels[meta.careerKind]} · {careerSummary(meta).join(' · ')}</p>{fact.fields.text?<p className={s.prose}>{fact.fields.text}</p>:null}{meta.highlights.length?<ul>{meta.highlights.map((line,index)=><li key={index}>{line}</li>)}</ul>:null}{meta.evidence.length?<ul className={s.evidence}>{meta.evidence.map((e,index)=><li key={index}>{e.url?<a href={e.url} rel="noreferrer" target="_blank">{e.label}</a>:e.label}{e.reference?<small>关联记录版本 {e.reference.link.revision}</small>:null}</li>)}</ul>:null}</section>;
 }):<p>尚未关联可用于此版本的原事实。</p>}</article></section>;
}
