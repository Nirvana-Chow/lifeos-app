type Channel='list'|'detail'|'history';
/** Prevent a late response from reviving data after auth failure or selection changes. */
export function createTasksReadFence(){
 const versions:Record<Channel,number>={list:0,detail:0,history:0};let disposed=false;
 return{
  begin(channel:Channel){const version=++versions[channel];return()=>!disposed&&version===versions[channel];},
  invalidate(...channels:Channel[]){for(const channel of channels.length?channels:['list','detail','history']as const)versions[channel]++;},
  dispose(){disposed=true;},
 };
}
