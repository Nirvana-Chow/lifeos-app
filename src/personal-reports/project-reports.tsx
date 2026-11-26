'use client';

import {useEffect,useRef,useState} from 'react';
import {useOwnerPageVerification} from '../personal-candidate/privacy';
import {projectDetailHref} from '../personal-candidate/project-detail-href.ts';
import {taskStatusLabels} from '../personal-candidate/task-editor-state.ts';
import {readProjectReports,ReportAccessError} from './report.ts';
import css from './reports.module.css';

type Review = Awaited<ReturnType<typeof readProjectReports>>;
const todayInShanghai = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
const observationTime = new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'medium'});

export function ProjectReports() {
  const verified = useOwnerPageVerification();
  const [review,setReview] = useState<Review|null>(null);
  const [status,setStatus] = useState<'loading'|'ready'|'error'|'locked'>('loading');
  const [selected,setSelected] = useState('');
  const [refresh,setRefresh] = useState(0);
  const [pins,setPins] = useState<ReadonlyMap<string,string>>(() => new Map());
  const binding = useRef<string|null>(null);

  useEffect(() => {
    if (!verified) return;
    let request: AbortController|undefined;
    function conceal() {
      request?.abort();
      setReview(null);
      setStatus('loading');
    }
    async function load() {
      conceal();
      if (document.visibilityState === 'hidden') return;
      const read = new AbortController();
      request = read;
      try {
        const snapshot = await readProjectReports(todayInShanghai.format(new Date()),read.signal);
        if (read.signal.aborted) return;
        if (binding.current !== null && binding.current !== snapshot.binding) throw new ReportAccessError();
        binding.current = snapshot.binding;
        setPins(previous => new Map(snapshot.reports.map(project => [project.id,previous.get(project.id) ?? project.stamp] as const)));
        setSelected(previous=>previous || snapshot.reports[0]?.id || '');
        setReview(snapshot);
        setStatus('ready');
      } catch (error) {
        if (read.signal.aborted) return;
        if (error instanceof ReportAccessError) {
          setPins(new Map());
          setSelected('');
          setStatus('locked');
        } else setStatus('error');
      }
    }
    const visibility = () => { if(document.visibilityState === 'hidden') conceal(); else void load(); };
    void load();
    window.addEventListener('focus',load);
    window.addEventListener('pagehide',conceal);
    document.addEventListener('visibilitychange',visibility);
    return () => {
      request?.abort();
      window.removeEventListener('focus',load);
      window.removeEventListener('pagehide',conceal);
      document.removeEventListener('visibilitychange',visibility);
    };
  },[verified,refresh]);

  const data = verified && status === 'ready' ? review : null;
  const project = data?.reports.find(item => item.id === selected) ?? (!selected ? data?.reports[0] : undefined);

  return <section className={css.page} aria-labelledby="project-reports-heading">
    <header className={css.header}>
      <h1 id="project-reports-heading">项目回顾</h1>
      <button type="button" onClick={()=>{setReview(null);setStatus('loading');setRefresh(value=>value+1);}} disabled={status==='loading'}>重新核对</button>
    </header>
    {!data ? <p role="status">{status==='locked'?'无法确认项目与待办读取权限，回顾已隐藏。':status==='error'?'暂时无法核验完整项目与待办快照。':'正在核对项目和待办…'}</p> : <>
      <p>观察时间 <time dateTime={data.observedAt}>{observationTime.format(new Date(data.observedAt))}（北京时间）</time></p>
      <p>资料覆盖：当前获准快照中的 {data.projectCount} 个项目、{data.taskCount} 条待办。</p>
      {data.reports.length>0 && <label className={css.selector}>项目
        <select value={project?.id ?? ''} onChange={event=>setSelected(event.target.value)}>
          {!project&&<option value="" disabled>请选择可访问的项目</option>}
          {data.reports.map(item=><option key={item.id} value={item.id}>
            {item.title}{item.duplicateTitle?' · '+item.id:''}
          </option>)}
        </select>
      </label>}
      {!project ? <p role="status">{selected?'原项目已不可访问。':'当前没有可访问的项目。'}</p> : <article className={css.panel}>
        <h2><a href={projectDetailHref(project.id)}>{project.title}</a></h2>
        <p>项目来源 ID {project.sourceId} · 修订 {project.revision}</p>
        {(project.referenceChanged||pins.get(project.id)!==project.stamp)&&<div role="status">
          <p>回顾待更新。引用的修订或当前关联已变化。</p>
          {pins.get(project.id)!==project.stamp&&<button type="button" onClick={()=>setPins(previous=>new Map(previous).set(project.id,project.stamp))}>以当前快照更新回顾</button>}
        </div>}
        <h3>关联待办</h3>
        {project.tasks.length ? <ul>{project.tasks.map(task=><li key={task.id}>
          <a href={'/personal/edit?type=todo&id='+encodeURIComponent(task.id)}>{task.title}</a>
          <span> · {taskStatusLabels[task.status]} · 修订 {task.revision}</span>
          <small>来源 ID {task.sourceId}{task.linkedProjectRevision!==null && ` · 关联时的项目修订 ${task.linkedProjectRevision}`}</small>
        </li>)}</ul> : <p>当前快照没有可核实的关联待办。</p>}
      </article>}
    </>}
  </section>;
}
