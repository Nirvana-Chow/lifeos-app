/** Enabling this adapter does not apply DDL or authorize any model call. */
export function readCaptureRunCandidateFlag(env:Record<string,string|undefined>):boolean{
 if(env.LIFEOS_CAPTURE_RUNS_CANDIDATE===undefined)return false;
 if(env.LIFEOS_CAPTURE_RUNS_CANDIDATE!=='1')throw Error('Explicit approved capture run extension required');
 return true;
}
