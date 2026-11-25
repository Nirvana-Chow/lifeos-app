import {Button} from '../ui-review/ui/button';
import {healthRecordCategories,type HealthRecordCategory,type HealthRecordStatus} from './record-filter';
import s from './health.module.css';

export function HealthRecordFilters({category,status,onCategory,onStatus}:{
  category:HealthRecordCategory;
  status:HealthRecordStatus;
  onCategory:(value:HealthRecordCategory)=>void;
  onStatus:(value:HealthRecordStatus)=>void;
}) {
  return <section className={s.filters} aria-label="身体基础记录">
    <div className={s.filterControls} role="group" aria-label="记录类别">
      {(Object.entries(healthRecordCategories) as [HealthRecordCategory,string][]).map(([key,label]) =>
        <Button key={key} type="button" size="sm" variant={category===key?'secondary':'ghost'} aria-pressed={category===key} onClick={()=>onCategory(key)}>{label}</Button>
      )}
      <span className={s.hint}>饮食 · 未接入</span>
    </div>
    {(category==='training'||category==='frisbee') && <label className={s.status}>
      运动状态
      <select value={status} onChange={event=>onStatus(event.target.value as HealthRecordStatus)}>
        <option value="all">全部状态</option>
        <option value="planned">计划</option>
        <option value="completed">已完成</option>
      </select>
    </label>}
    <p className={s.hint}>来源为站内手工记录，历史覆盖未知。Apple 健康与训记自动来源未接入。</p>
    {category==='frisbee' && <p className={s.hint}>飞盘筛选只显示活动类别为「其他」、标题包含「飞盘」「飛盤」或「Frisbee」的记录。</p>}
  </section>;
}
