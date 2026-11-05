/**
 * Adapted from Reactive Resume formatResumeDates, MIT (c) 2026 Amruth Pillai.
 * Upstream a53a86a4be6d57f59b6096b20e55744f811fbb76, packages/schema/src/resume/dates.ts.
 * Full license and adaptation details: third-party/personal-career/.
 */
import type {CareerPeriod} from './domain.ts';

/** Keep the original precision; null endings do not silently mean “Present”. */
export function formatCareerDates(dates:CareerPeriod):string {
 const start=dates.startOn??'开始日期未知';
 const end=dates.status==='current'?'至今':dates.endOn??'结束日期未知';
 if(dates.startOn===null&&dates.endOn===null&&dates.status==='unknown')return '日期未知';
 return `${start} – ${end}`;
}
