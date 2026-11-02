/** Enabling the adapter never applies DDL or grants authority for model calls. */
export function readChatCandidateFlag(env:Record<string,string|undefined>):boolean{
 if(env.LIFEOS_CHAT_CANDIDATE===undefined)return false;
 if(env.LIFEOS_CHAT_CANDIDATE!=='1')throw Error('Explicit approved chat extension required');
 return true;
}
