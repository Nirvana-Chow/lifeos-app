'use client';

import {useState} from 'react';
import {requirements, selectRequirements, type ImplementationStatus, type Requirement} from '../platform/requirements';
import {Badge} from './ui/badge';
import styles from './requirements-page.module.css';

const baseline = requirements();
const implementationLabels: Record<ImplementationStatus, string> = {
 not_started: '未开始', partial: '部分实现', implemented: '源码已实现',
};
const acceptanceLabels: Record<Requirement['status'], string> = {
 not_started: '尚未验收', in_progress: '开发中，未验收', awaiting_acceptance: '待本人验收', accepted: '已验收',
};
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
function RequirementDetail({item}: {item: Requirement}) {
 const m = item.roadmap;
 const sourceRefs = [...new Set([...item.sourceRefs, ...item.evidence.map(e => e.ref)])].filter(ref => !m?.issueRefs.includes(ref) && !m?.prRefs.includes(ref));
 return <details className={styles.details}>
  <summary>验收与依据</summary>
  <div className={styles.detailBody}>
   <p>{item.description}</p>
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
  </div>
 </details>;
}

/** Public product metadata only; the authenticated host owns navigation and access checks. */
export function RequirementsPage() {
 const [query, setQuery] = useState('');
 const [implementation, setImplementation] = useState<ImplementationStatus | 'all'>('all');
 const rows = selectRequirements(baseline, {query, implementation});
 const route = baseline.roadmap;
 const phases = route?.phases.toSorted((a, b) => a.order - b.order) ?? [];
 const phaseById = new Map(phases.map(phase => [phase.id, phase]));
 const currentPhase = phases.find(phase => phase.id === route?.currentPhaseId);
 const implemented = baseline.requirements.filter(item => item.roadmap?.implementation === 'implemented').length;
 const partial = baseline.requirements.filter(item => item.roadmap?.implementation === 'partial').length;
 const unstarted = baseline.requirements.filter(item => item.roadmap?.implementation === 'not_started').length;
 const accepted = baseline.requirements.filter(item => item.status === 'accepted').length;
 return <section className={styles.page} aria-label="需求池">
  <header className={styles.intro}><div><p>项目目标</p><h2>{route?.goal ?? baseline.scopeNote}</h2></div></header>
  <dl className={styles.stats} aria-label="需求统计">
   <div><dt>需求</dt><dd>{baseline.requirements.length}</dd></div>
   <div><dt>源码已实现</dt><dd>{implemented}</dd></div>
   <div><dt>部分实现</dt><dd>{partial}</dd></div>
   <div><dt>未开始</dt><dd>{unstarted}</dd></div>
   <div><dt>本人已验收</dt><dd>{accepted}</dd></div>
  </dl>
  <section className={styles.route} aria-label="项目路线图">
   <div className={styles.sectionTitle}><h2>开发路径</h2><p>当前阶段：{currentPhase?.title ?? '待明确'}</p></div>
   <ol className={styles.phases} aria-label="开发路径">{phases.map(phase => <li key={phase.id} aria-current={phase.id === route?.currentPhaseId ? 'step' : undefined}>
    <span className={styles.phaseNumber} aria-hidden="true">{phase.order}</span><div><h3>{phase.title}{phase.id === route?.currentPhaseId ? <span className={styles.current}>当前</span> : null}</h3><p>{phase.goal}</p></div>
   </li>)}</ol>
   <p className={styles.next}><strong>下一步：</strong>{route?.nextStep ?? '按原需求逐项补充验收证据。'}</p>
   <p className={styles.note}>阶段按开发路径排序；基础能力仍会持续完善。源码实现、自动化验证、部署和本人验收分别记录。</p>
  </section>
  <div className={styles.filters} role="search" aria-label="筛选需求">
   <label htmlFor="requirements-search">搜索需求<input id="requirements-search" type="search" placeholder="标题、编号、来源或下一步" value={query} onChange={event => setQuery(event.target.value)}/></label>
   <label htmlFor="requirements-implementation">实现状态<select id="requirements-implementation" value={implementation} onChange={event => setImplementation(event.target.value as ImplementationStatus | 'all')}>
    <option value="all">全部实现状态</option>{Object.entries(implementationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
   </select></label>
   <p role="status" aria-live="polite">显示 {rows.length} / {baseline.requirements.length} 项</p>
  </div>
  <div className={styles.tableContainer}>
   <table className={styles.table} role="table"><caption>需求清单</caption>
    <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">需求</th><th scope="col" role="columnheader">阶段 / 优先级</th><th scope="col" role="columnheader">实现范围</th><th scope="col" role="columnheader">验收状态</th><th scope="col" role="columnheader">下一步</th></tr></thead>
    <tbody role="rowgroup">{rows.map(item => <tr key={item.id} role="row" data-requirement-id={item.id}>
     <th scope="row" role="rowheader" className={styles.requirement}><span className={styles.id}>{item.id}</span><h3>{item.title}</h3><RequirementDetail item={item}/></th>
     <td role="cell" data-label="阶段 / 优先级"><span>{phaseById.get(item.roadmap?.phaseId ?? '')?.title ?? '未排阶段'}</span><Badge variant="outline">{item.roadmap?.priority ?? '待定'}</Badge><small>{item.delivery === 'current' ? '本阶段' : '后续跟进'}</small></td>
     <td role="cell" data-label="实现范围"><Badge variant="secondary">{item.roadmap ? implementationLabels[item.roadmap.implementation] : '待核验'}</Badge><p>{item.roadmap?.summary ?? item.description}</p></td>
     <td role="cell" data-label="验收状态"><span>{acceptanceLabels[item.status]}</span></td>
     <td role="cell" data-label="下一步"><p>{item.roadmap?.nextStep ?? '按验收条件逐项验证。'}</p>{item.blockedBy.length > 0 ? <small>有依赖，展开查看</small> : null}</td>
    </tr>)}</tbody>
   </table>
   {rows.length === 0 ? <p className={styles.empty}>没有匹配的需求。可修改关键词或选择全部实现状态。</p> : null}
  </div>
  <p className={styles.note}>基线 {baseline.baselineVersion} · 候选版本 {baseline.candidateVersion}。{baseline.scopeNote} 新想法进入待办范围，另行确认后实施。</p>
 </section>;
}
