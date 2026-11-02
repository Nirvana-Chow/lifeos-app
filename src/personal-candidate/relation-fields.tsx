'use client';
import type {PublicEntry} from '../platform/contracts';
import type {PersonalReference,PersonalRelations} from './business';
const reference=(e:PublicEntry):PersonalReference=>({id:e.id,sourceId:e.source.id,revision:e.revision});
export function RelationFields({value,onChange,options,project=true}:{value:PersonalRelations;onChange:(v:PersonalRelations)=>void;options:Record<string,PublicEntry[]>;project?:boolean}){
 function select(label:string,type:string,current:PersonalReference|null,change:(v:PersonalReference|null)=>void){const rows=options[type]??[],encoded=current?JSON.stringify(current):'',found=rows.some(e=>JSON.stringify(reference(e))===encoded);return <label>{label}<select value={encoded} onChange={e=>change(e.target.value?JSON.parse(e.target.value):null)}><option value="">不关联</option>{current&&!found&&<option value={encoded}>保留原引用 · 版本 {current.revision}（目标已变更或不在窗口内）</option>}{rows.map(e=><option key={e.id} value={JSON.stringify(reference(e))}>{'title'in e.draft?e.draft.title:'记录'} · 版本 {e.revision}</option>)}</select></label>;}
 return <>{project&&select('所属项目','project',value.project,project=>onChange({...value,project}))}{select('所属领域','domain',value.domain,domain=>onChange({...value,domain}))}{select('关联主题','topic',value.topics[0]??null,topic=>onChange({...value,topics:topic?[topic,...value.topics.slice(1)]:value.topics.slice(1)}))}{value.topics.length>1&&<p>另有 {value.topics.length-1} 个已保存主题引用，保留原关系。</p>}</>;
}
