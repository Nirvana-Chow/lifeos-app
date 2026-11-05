'use client';
import type {PersonalPlanningFields} from './planning';
/** Native date controls; both fields remain optional and separate from a deadline. */
export function PlanningInputs({value,onChange,className}:{value:PersonalPlanningFields;onChange:(field:'plannedStartOn'|'plannedEndOn',value:string|null)=>void;className?:string}){
 return <div role="group" aria-label="计划排期（可留空）" className={className}><label>计划开始<input type="date" value={value.plannedStartOn??''} max={value.plannedEndOn??undefined} onChange={event=>onChange('plannedStartOn',event.target.value||null)}/></label><label>计划结束<input type="date" value={value.plannedEndOn??''} min={value.plannedStartOn??undefined} onChange={event=>onChange('plannedEndOn',event.target.value||null)}/></label></div>;
}
