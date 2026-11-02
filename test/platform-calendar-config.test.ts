import test from'node:test';import assert from'node:assert/strict';import{readCalendarCandidateFlag}from'../src/platform/calendar-config.ts';
test('calendar extension is default-off and accepts only the explicit opt-in flag',()=>{
 assert.equal(readCalendarCandidateFlag({}),false);assert.equal(readCalendarCandidateFlag({LIFEOS_CALENDAR_CANDIDATE:'1'}),true);
 for(const value of ['true','0','yes',''])assert.throws(()=>readCalendarCandidateFlag({LIFEOS_CALENDAR_CANDIDATE:value}));
});
