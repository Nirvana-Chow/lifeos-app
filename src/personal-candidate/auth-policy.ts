/** Session writes (login/rate limiting) are distinct from business record writes.
 * Default remains permit-bound. Deployment approval is required to enable this flag.
 */
export function personalAuthPolicy(env:Record<string,string|undefined>,requireBusinessWrite:()=>Promise<void>){
 const flag=env.LIFEOS_PERSONAL_READONLY_LOGIN;
 if(flag!==undefined&&flag!=='owner-session-v1')throw Error('Personal authentication approval unavailable');
 const approved=flag==='owner-session-v1';
 return {assertSessionWrite:async()=>{if(!approved)await requireBusinessWrite();},loginAllowed:(businessWritable:boolean)=>approved||businessWritable};
}
