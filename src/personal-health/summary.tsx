import type {HealthPersonalFields} from './domain';
import type {HealthEntry} from './projection';
import {healthKindLabels,healthSummary} from './presentation';
import s from './health.module.css';

export function HealthRecordSummary({value}:{value:HealthPersonalFields}) {
  return <div className={s.recordSummary}>
    <p>{healthKindLabels[value.personal.healthKind]} · {value.occurredOn ?? '日期未知'}</p>
    <p>{healthSummary(value)}</p>
    <p className={s.hint}>手工记录{value.personal.source.label ? '：'+value.personal.source.label : ''} · {value.personal.timeZone}</p>
  </div>;
}

/** Counts describe only supplied, successfully read records; no coverage is inferred. */
export function HealthEntriesSummary({entries}:{entries:readonly HealthEntry[]}) {
  if (!entries.length) return <p className={s.empty}>暂无健康记录。添加身体测量、睡眠或训练记录后可查看摘要与趋势。</p>;
  const body = entries.filter(entry => entry.fields.personal.healthKind === 'body').length;
  const sleep = entries.filter(entry => entry.fields.personal.healthKind === 'sleep').length;
  const training = entries.filter(entry => entry.fields.personal.healthKind === 'training');
  const completed = training.filter(entry => entry.fields.personal.healthKind === 'training' && entry.fields.personal.state === 'completed').length;
  return <section aria-label="当前健康记录摘要" className={s.summary}>
    <p className={s.hint}>当前已读 {entries.length} 条记录；来源覆盖情况以实际接入为准。</p>
    <dl><div><dt>身体测量</dt><dd>{body}</dd></div><div><dt>睡眠记录</dt><dd>{sleep}</dd></div><div><dt>已完成训练</dt><dd>{completed}</dd></div><div><dt>训练计划</dt><dd>{training.length-completed}</dd></div></dl>
  </section>;
}
