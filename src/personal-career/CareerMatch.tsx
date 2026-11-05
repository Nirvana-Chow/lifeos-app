'use client';
import {projectCareerRequirements,type CareerRecord} from './projection';
import s from './career.module.css';
export function CareerMatch({record,records,onOpenRecord}:{record:CareerRecord;records:readonly CareerRecord[];onOpenRecord?:(record:CareerRecord)=>void}){
 const rows=projectCareerRequirements(record.fields.personal,records);
 return <section aria-label="JD 要求与事实证据" className={s.match}><h3>岗位要求与事实证据</h3>{rows.length?<div className={s.tableWrap}><table><caption>本人记录的要求、证据与待补行动；不生成资格判断或匹配分数。</caption><thead><tr><th scope="col">岗位要求</th><th scope="col">已关联原事实</th><th scope="col">缺口 / 未知</th><th scope="col">补证或行动</th></tr></thead><tbody>{rows.map((row,index)=><tr key={index}><th scope="row">{row.requirement}</th><td>{row.facts.length?<ul>{row.facts.map(fact=><li key={fact.id}>{onOpenRecord?<button type="button" onClick={()=>onOpenRecord(fact)}>{fact.fields.title}</button>:fact.fields.title}<small>版本 {fact.revision}</small></li>)}</ul>:<p>尚无可核对的关联事实</p>}{row.unavailable.length?<p className={s.hint}>{row.unavailable.length} 条事实引用已变更或未读到，暂不作为证据。</p>:null}</td><td>{row.gap??'未填写'}</td><td>{row.nextAction??'未填写'}</td></tr>)}</tbody></table></div>:<p className={s.hint}>尚未拆分岗位要求。保留 JD 原文后，可逐条关联原事实与补证行动。</p>}</section>;
}
