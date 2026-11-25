import type {HealthPersonalFields} from './domain.ts';

export const healthRecordCategories = {
  all: '全部记录',
  sleep: '睡眠',
  training: '健身训练',
  frisbee: '飞盘',
} as const;

export type HealthRecordCategory = keyof typeof healthRecordCategories;
export type HealthRecordStatus = 'all' | 'planned' | 'completed';

export function matchesHealthRecord(
  {title, personal}: HealthPersonalFields,
  category: HealthRecordCategory,
  status: HealthRecordStatus,
): boolean {
  if (category === 'all') return true;
  if (category === 'sleep') return personal.healthKind === 'sleep';
  if (personal.healthKind !== 'training') return false;

  // The existing form stores frisbee as "other". Use its explicit record title.
  const frisbee = personal.activity === 'other' && /飞盘|飛盤|\bfrisbee\b/i.test(title);
  return frisbee === (category === 'frisbee') && (status === 'all' || personal.state === status);
}
