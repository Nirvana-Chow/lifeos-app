import {Button} from '../ui-review/ui/button';
import {healthRecordCategories,type ExerciseCategory,type HealthRecordStatus} from './record-filter';
import s from './health.module.css';

export function ExerciseRecordFilters({category,status,onCategory,onStatus}:{
  category:ExerciseCategory;
  status:HealthRecordStatus;
  onCategory:(value:ExerciseCategory)=>void;
  onStatus:(value:HealthRecordStatus)=>void;
}) {
  return <section className={s.filters} aria-label="运动记录筛选">
    <div className={s.filterControls} role="group" aria-label="记录类别">
      {(['all','training','frisbee'] as const).map(key =>
        <Button key={key} type="button" size="sm" variant={category===key?'secondary':'ghost'} aria-pressed={category===key} onClick={()=>onCategory(key)}>{key==='all'?'全部运动':healthRecordCategories[key]}</Button>
      )}
    </div>
    <label className={s.status}>
      运动状态
      <select value={status} onChange={event=>onStatus(event.target.value as HealthRecordStatus)}>
        <option value="all">全部状态</option>
        <option value="planned">计划</option>
        <option value="completed">已完成</option>
      </select>
    </label>
    {category==='frisbee' && <p className={s.hint}>飞盘筛选只显示活动类别为「其他」、标题包含「飞盘」「飛盤」或「Frisbee」的记录。</p>}
  </section>;
}
