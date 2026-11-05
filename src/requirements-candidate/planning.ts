export type PlannedDates={plannedStartOn:string|null;plannedEndOn:string|null};
/** A missing endpoint is a dated point, never a fabricated interval. */
export function requirementSchedule<T extends{id:string}>(rows:readonly T[],planning:ReadonlyMap<string,PlannedDates>){
 const scheduled=rows.flatMap(item=>{const dates=planning.get(item.id);if(!dates?.plannedStartOn&&!dates?.plannedEndOn)return[];return[{item,startOn:dates.plannedStartOn,endOn:dates.plannedEndOn,kind:dates.plannedStartOn&&dates.plannedEndOn?'range' as const:dates.plannedStartOn?'start' as const:'end' as const,from:Date.parse((dates.plannedStartOn??dates.plannedEndOn)+'T00:00:00Z'),to:Date.parse((dates.plannedEndOn??dates.plannedStartOn)+'T00:00:00Z')}];}).sort((a,b)=>a.from-b.from);
 const dates=scheduled.flatMap(item=>[item.from,item.to]),min=dates.length?Math.min(...dates):0,max=dates.length?Math.max(...dates):0,span=Math.max(max-min,86400000),ids=new Set(scheduled.map(row=>row.item.id));
 return{scheduled:scheduled.map(row=>({...row,left:(row.from-min)/span*100,width:(row.to-row.from)/span*100})),unscheduled:rows.filter(row=>!ids.has(row.id)),minOn:dates.length?new Date(min).toISOString().slice(0,10):null,maxOn:dates.length?new Date(max).toISOString().slice(0,10):null};
}
