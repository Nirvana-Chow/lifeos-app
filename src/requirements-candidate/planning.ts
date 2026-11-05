export type PlannedDates={plannedStartOn:string|null;plannedEndOn:string|null};
const day=86_400_000;
function calendarDay(value:string|null):number|null{
 if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const timestamp=Date.parse(value+'T00:00:00Z');
 return Number.isFinite(timestamp)&&new Date(timestamp).toISOString().slice(0,10)===value?timestamp:null;
}
/** Only complete, valid saved intervals become bars. Deadlines never imply a start. */
export function requirementSchedule<T extends{id:string}>(rows:readonly T[],planning:ReadonlyMap<string,PlannedDates>){
 const scheduled=rows.flatMap(item=>{
  const dates=planning.get(item.id);if(!dates)return[];
  const from=calendarDay(dates.plannedStartOn),to=calendarDay(dates.plannedEndOn);
  if(from===null||to===null||from>to)return[];
  return[{item,startOn:dates.plannedStartOn!,endOn:dates.plannedEndOn!,kind:'range' as const,from,to}];
 }).sort((a,b)=>a.from-b.from);
 const dates=scheduled.flatMap(item=>[item.from,item.to]),min=dates.length?Math.min(...dates):0,max=dates.length?Math.max(...dates):0,span=Math.max(max-min,day),ids=new Set(scheduled.map(row=>row.item.id));
 return{scheduled:scheduled.map(row=>({...row,left:(row.from-min)/span*100,width:(row.to-row.from)/span*100})),unscheduled:rows.filter(row=>!ids.has(row.id)),minOn:dates.length?new Date(min).toISOString().slice(0,10):null,maxOn:dates.length?new Date(max).toISOString().slice(0,10):null};
}
