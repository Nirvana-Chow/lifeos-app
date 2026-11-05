'use client';

import {useEffect,useRef,useState} from 'react';
import type {RoadmapPhase,Requirement} from '../platform/requirements';
import {Dialog,DialogContent,DialogTitle,DialogClose} from './ui/dialog';
import {Button} from './ui/button';
import {implementationLabels,acceptanceLabels} from './requirements-views';
import type {RequirementFields} from '../requirements-candidate/domain';
import styles from './requirements-page.module.css';

const publicRoot = 'https://github.com/Nirvana-Chow/lifeos-app/';
function referenceHref(ref: string): string | undefined {
 if (/^https:\/\/github\.com\/Nirvana-Chow\/lifeos-app\/(issues|pull)\/[1-9]\d*$/.test(ref)) return ref;
 // Only repository paths become links. Unrecognized evidence remains plain text.
 if (!/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+(?:#\d+\.\d+)?$/.test(ref) || ref.split('/').includes('..')) return undefined;
 const [path, task] = ref.split('#');
 const sections: Record<string, string> = {1: '1-shared-interface-and-header-appearance', 2: '2-table-candidate-validation', 3: '3-rendered-integration-and-delivery'};
 const anchor = task ? sections[task.split('.')[0]] : undefined;
 return publicRoot + 'blob/main/' + path + (anchor ? '#' + anchor : '');
}
function Reference({value, label}: {value: string; label?: string}) {
 const href = referenceHref(value);
 return href ? <a href={href}>{label ?? value}</a> : <span>{label ?? value}</span>;
}
function RequirementDetailBody({item,showDescription=true}: {item: Requirement;showDescription?:boolean}) {
 const m = item.roadmap;
 const sourceRefs = [...new Set([...item.sourceRefs, ...item.evidence.map(e => e.ref)])].filter(ref => !m?.issueRefs.includes(ref) && !m?.prRefs.includes(ref));
 return <div className={styles.detailBody}>
   {showDescription?<p>{item.description}</p>:null}
   <h4>验收条件</h4><ul>{item.acceptanceCriteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul>
   {item.blockedBy.length > 0 ? <><h4>依赖与未完成</h4><ul>{item.blockedBy.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul></> : null}
   <h4>公开追踪</h4>
   {m && m.issueRefs.length + m.prRefs.length + m.specTaskRefs.length > 0 ? <ul className={styles.references}>
    {m.issueRefs.map(ref => <li key={ref}><Reference value={ref} label={'Issue #' + ref.split('/').at(-1)}/></li>)}
    {m.prRefs.map(ref => <li key={ref}><Reference value={ref} label={'PR #' + ref.split('/').at(-1)}/></li>)}
    {m.specTaskRefs.map(ref => <li key={ref}><Reference value={ref} label={'OpenSpec ' + ref.split('#')[1]}/></li>)}
   </ul> : <p>沿原始需求与来源记录推进。</p>}
   <h4>来源与源码依据</h4>
   <ul>{sourceRefs.map(ref => <li key={ref}>{item.evidence.some(e => e.ref === ref && e.scope === 'source') ? '源码：' : ''}<Reference value={ref}/></li>)}</ul>
   {item.evidence.length === 0 ? <p>尚无实现证据。</p> : null}
   <p>源码依据说明已有实现范围，不代表部署或本人验收。</p>
   {item.acceptance ? <p>本人验收：<Reference value={item.acceptance.ref}/></p> : null}
 </div>;
}


export function RequirementDetail({container,item,phaseTitle,expanded,onExpandedChange,onClose,returnFocus,editor,loading=false}:{container?:HTMLElement|null;item:Requirement|null;phaseTitle:string;expanded:boolean;onExpandedChange:()=>void;onClose:()=>void;returnFocus:()=>void;editor?:RequirementEditorProps;loading?:boolean}){
 const title=useRef<HTMLHeadingElement>(null);
 const [bounds,setBounds]=useState<{left:number;top:number;width:number;height:number}|null>(null);
 useEffect(()=>{if(!expanded||!container){setBounds(null);return;}const update=()=>{const r=container.getBoundingClientRect();setBounds({left:r.left,top:r.top,width:r.width,height:r.height});};update();const observer=new ResizeObserver(update);observer.observe(container);window.addEventListener('resize',update);return()=>{observer.disconnect();window.removeEventListener('resize',update);};},[expanded,container]);
 return <Dialog open={item!==null} onOpenChange={open=>{if(!open)onClose();}}><DialogContent container={container} style={expanded&&bounds?{...bounds,maxWidth:bounds.width,maxHeight:bounds.height,transform:'none',translate:'none'}:undefined} className={`${styles.dialog} ${expanded?styles.fullscreen:''}`} showCloseButton={false} aria-describedby={undefined} onOpenAutoFocus={event=>{event.preventDefault();title.current?.focus();}} onCloseAutoFocus={event=>{event.preventDefault();returnFocus();}}>
  <header className={styles.dialogHeader}><div><span className={styles.id}>{item?.id}</span><DialogTitle ref={title} tabIndex={-1}>{item?.title}</DialogTitle></div><div className={styles.dialogActions}><Button variant="outline" onClick={onExpandedChange}>{expanded?'收起详情':'展开到内容区'}</Button><DialogClose asChild><Button variant="outline">关闭</Button></DialogClose></div></header>
  <div className={styles.dialogBody}>{item?<><div className={styles.detailMeta}><span>{phaseTitle}</span><span>{item.roadmap?.priority}</span><span>{item.roadmap?implementationLabels[item.roadmap.implementation]:'待核验'}</span><span>{acceptanceLabels[item.status]}</span></div><p><strong>下一步：</strong>{item.roadmap?.nextStep??'按验收条件逐项验证。'}</p>{item.roadmap?<p>{item.roadmap.summary}</p>:null}{loading?<p role="status">正在读取当前需求…</p>:editor?<><RequirementEditor key={editor.editorId} {...editor}/><details className={styles.evidenceDisclosure}><summary>验收与工程依据</summary><RequirementDetailBody item={item} showDescription={false}/></details></>:<RequirementDetailBody item={item}/>}</>:null}</div>
 </DialogContent></Dialog>;
}

export type RequirementEditorProps={editorId:string;fields:RequirementFields;phases:RoadmapPhase[];writable:boolean;busy:boolean;unknown:boolean;conflict:boolean;error:string;onSave:(fields:RequirementFields)=>void|Promise<void>;onDirty:(dirty:boolean)=>void;onRetry:()=>void;onRefresh:()=>void};
function RequirementEditor({fields,phases,writable,busy,unknown,conflict,error,onSave,onDirty,onRetry,onRefresh}:RequirementEditorProps){
 const [draft,setDraft]=useState<RequirementFields>(()=>structuredClone(fields));
 const original=useRef(JSON.stringify(fields));
 const dirty=JSON.stringify(draft)!==original.current;
 useEffect(()=>{onDirty(dirty);},[dirty,onDirty]);
 const change=(name:keyof RequirementFields,value:string|null)=>setDraft(previous=>({...previous,[name]:value}));
 const locked=busy||unknown||!writable||conflict;
 return <form className={styles.editor} aria-label="编辑需求" onSubmit={event=>{event.preventDefault();if(!locked)void onSave(draft);}}>
  {conflict?<p role="alert">公共需求基线已变化，私有修改已保留，请先核对来源与当前基线。</p>:null}
  <label htmlFor="requirement-title">需求标题<input id="requirement-title" name="title" required maxLength={240} disabled={locked} value={draft.title} onChange={event=>change('title',event.target.value)}/></label>
  <div className={styles.descriptionField}><label htmlFor="requirement-body">需求描述</label><textarea id="requirement-body" name="body" aria-describedby="requirement-body-count" maxLength={16384} rows={8} disabled={locked} value={draft.body} onChange={event=>change('body',event.target.value)}/><span id="requirement-body-count" className={styles.fieldHint}>{draft.body.length} / 16384</span></div>
  <div className={styles.planningFields}><label htmlFor="requirement-phase">阶段<select id="requirement-phase" name="phaseId" aria-label="阶段" disabled={locked} value={draft.phaseId} onChange={event=>change('phaseId',event.target.value)}>{phases.map(phase=><option key={phase.id} value={phase.id}>{phase.title}</option>)}</select></label>
  <label htmlFor="requirement-priority">优先级<select id="requirement-priority" name="priority" aria-label="优先级" disabled={locked} value={draft.priority} onChange={event=>change('priority',event.target.value)}>{['P0','P1','P2','P3'].map(priority=><option key={priority}>{priority}</option>)}</select></label>
  <label htmlFor="requirement-start">计划开始日期<input id="requirement-start" name="plannedStartOn" type="date" disabled={locked} value={draft.plannedStartOn??''} max={draft.plannedEndOn??undefined} onChange={event=>change('plannedStartOn',event.target.value||null)}/></label>
  <label htmlFor="requirement-end">计划结束日期<input id="requirement-end" name="plannedEndOn" type="date" disabled={locked} value={draft.plannedEndOn??''} min={draft.plannedStartOn??undefined} onChange={event=>change('plannedEndOn',event.target.value||null)}/></label></div>
  {error?<p role="status">{error}</p>:null}
  <div className={styles.editorActions}><Button type="submit" disabled={locked||!draft.title.trim()}>{busy?'正在保存…':'保存需求'}</Button><Button type="button" variant="outline" onClick={onRefresh} disabled={busy||unknown}>重新读取</Button>{unknown?<Button type="button" variant="outline" disabled={!writable} onClick={onRetry}>重试原请求并回读</Button>:null}<span>{dirty?'内容尚未保存':unknown?'保留原请求':'修改仅影响需求内容与计划'}</span></div>
 </form>;
}
