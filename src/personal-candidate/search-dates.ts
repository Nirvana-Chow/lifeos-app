import {validateCalendarDate} from '../calendar-candidate/domain.ts';
import {dateInCalendarZone} from '../calendar-candidate/personal-projection.ts';
import {PlatformError,type InboxDraft,type TodoDraft} from '../platform/domain.ts';

export type PersonalSearchDateRange = {from?: string; to?: string};

export function readPersonalSearchDateRange(from?: unknown, to?: unknown): PersonalSearchDateRange {
 const start = from === undefined || from === '' ? undefined : validateCalendarDate(from);
 const end = to === undefined || to === '' ? undefined : validateCalendarDate(to);
 if (start && end && start > end) throw new PlatformError(400,'INVALID_RANGE','开始日期不能晚于结束日期。');
 return {...(start ? {from:start} : {}), ...(end ? {to:end} : {})};
}

export function matchesPersonalSearchDate(date: string|null, {from,to}: PersonalSearchDateRange): boolean {
 if (!from && !to) return true;
 return date !== null && (!from || date >= from) && (!to || date <= to);
}

type DatedDraft = Pick<TodoDraft,'dueOn'> | Pick<InboxDraft,'occurredOn'|'personal'>;

export function personalSearchRecordDate(draft: DatedDraft): {date:string|null;dateLabel:string} {
 if ('dueOn' in draft) return {date:draft.dueOn,dateLabel:'截止日期'};
 const calendar = draft.personal;
 if (!calendar || !('type' in calendar) || calendar.type !== 'calendar') return {date:draft.occurredOn,dateLabel:'记录日期'};

 switch (calendar.calendarKind) {
  case 'event': {
   const schedule = calendar.schedule;
   if (!schedule || schedule.kind === 'all-day') return {date:schedule?.startDate ?? null,dateLabel:'开始日期'};
   try {
    return {date:dateInCalendarZone(schedule.startAt,'Asia/Shanghai'),dateLabel:'开始日期（北京时间）'};
   } catch (error) {
    // A stored UTC instant may cross the last supported year in Shanghai.
    if (error instanceof PlatformError && error.code === 'INVALID_DATE') return {date:null,dateLabel:'开始日期（北京时间）'};
    throw error;
   }
  }
  case 'anniversary': return {date:calendar.originOn,dateLabel:'原始日期'};
  case 'countdown': return {date:calendar.targetOn,dateLabel:'目标日期'};
  case 'life-stage': return {date:calendar.startOn,dateLabel:'开始日期'};
 }
}
