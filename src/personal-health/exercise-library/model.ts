import type {TrainingAnalyticsSnapshot,TrainingMuscle} from '../training-analytics/model.ts';

type ExerciseGuide = Readonly<{
  purpose:string;
  source:Readonly<{label:string;url:string;checkedOn:string}>;
}>;
export type ExerciseLibraryRow = {
  name:string;
  guide:ExerciseGuide|null;
  observed:{sets:number;lastDate:string;muscles:TrainingMuscle[]}|null;
};

const nasm = (slug:string) => ({label:'NASM 动作教程',url:'https://www.nasm.org/resource-center/exercise-library/'+slug,checkedOn:'2026-11-12'});
const ace = (slug:string) => ({label:'ACE 动作教程',url:'https://www.acefitness.org/resources/everyone/exercise-library/'+slug+'/',checkedOn:'2026-11-12'});

// Thin, read-only reference links for exact names already used by the existing
// Xunji projection. This is neither a movement-name catalog nor a personal plan.
const guides:ReadonlyMap<string,ExerciseGuide> = new Map([
  ['杠铃卧推',{purpose:'上肢推力训练，主要练胸，肱三头肌和肩前侧参与。',source:nasm('barbell-bench-press')}],
  ['俯卧撑',{purpose:'自重推力训练，练胸、肱三头肌和肩前侧，同时保持躯干稳定。',source:nasm('push-up')}],
  ['引体向上',{purpose:'垂直拉力训练，主要练背部，肱二头肌和握力参与。',source:nasm('pull-up')}],
  ['杠铃罗马尼亚硬拉',{purpose:'髋铰链训练，主要练腘绳肌与臀部，并维持躯干稳定。',source:nasm('romanian-deadlift-barbell')}],
  ['自重深蹲',{purpose:'练习髋膝协同屈伸，训练腿部与臀部，并保持躯干控制。',source:ace('135/bodyweight-squat')}],
  ['鸟狗式',{purpose:'四点支撑中交替伸出对侧手脚，练核心稳定与四肢协调。',source:ace('14/bird-dog')}],
  ['死虫',{purpose:'仰卧交替移动对侧手脚，练核心抗伸展与躯干控制。',source:nasm('dead-bug')}],
  ['平板支撑',{purpose:'静态支撑中抵抗腰部过度伸展，练核心稳定与耐力。',source:nasm('plank')}],
]);

/** Only supplied completed-set observations count; no absent record becomes 0. */
export function buildExerciseLibrary(source?:TrainingAnalyticsSnapshot|null):ExerciseLibraryRow[] {
  const rows = new Map<string,ExerciseLibraryRow>(Array.from(guides,([name,guide]) => [name,{name,guide,observed:null}]));
  for (const day of source?.days ?? []) {
    for (const set of day.sets) {
      let row = rows.get(set.exercise);
      if (!row) {row = {name:set.exercise,guide:null,observed:null};rows.set(set.exercise,row);}
      if (!row.observed) row.observed = {sets:0,lastDate:day.date,muscles:[]};
      row.observed.sets++;
      if (day.date > row.observed.lastDate) row.observed.lastDate = day.date;
      if (set.muscle && !row.observed.muscles.includes(set.muscle)) row.observed.muscles.push(set.muscle);
    }
  }
  return Array.from(rows.values()).sort((a,b) => {
    if (!!a.observed !== !!b.observed) return a.observed ? -1 : 1;
    return (b.observed?.lastDate ?? '').localeCompare(a.observed?.lastDate ?? '') || a.name.localeCompare(b.name,'zh-CN');
  });
}

export function filterExerciseLibrary(rows:readonly ExerciseLibraryRow[],search:string):ExerciseLibraryRow[] {
  const query = search.trim().toLocaleLowerCase('zh-CN');
  return rows.filter(row => !query || (row.name+' '+(row.guide?.purpose ?? '')).toLocaleLowerCase('zh-CN').includes(query));
}
