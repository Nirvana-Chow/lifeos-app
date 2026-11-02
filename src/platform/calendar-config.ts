/** An optional adapter flag is not authority to apply DDL or import personal data. */
export function readCalendarCandidateFlag(env:Record<string,string|undefined>):boolean{
 if(env.LIFEOS_CALENDAR_CANDIDATE===undefined)return false;
 if(env.LIFEOS_CALENDAR_CANDIDATE!=='1')throw Error('Explicit approved calendar extension required');
 return true;
}
