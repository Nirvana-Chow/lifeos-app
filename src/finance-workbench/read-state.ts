import type {FinanceEntry} from './client.ts';
type Channel='list'|'detail'|'history'|'readback';
/** Every detail/save/auth path shares these fences so late reads cannot revive stale state. */
export function createFinanceReadFence(){
 const versions:Record<Channel,number>={list:0,detail:0,history:0,readback:0};let disposed=false;
 return{begin(channel:Channel){const version=++versions[channel];return()=>!disposed&&version===versions[channel];},invalidate(...channels:Channel[]){for(const channel of channels.length?channels:['list','detail','history','readback']as const)versions[channel]++;},dispose(){disposed=true;}};
}
export function assertFinanceReadback(current:FinanceEntry,receipt:FinanceEntry):void{
 if(current.id!==receipt.id||current.revision<receipt.revision||current.source.id!==receipt.source.id||(current.revision===receipt.revision&&JSON.stringify(current.draft)!==JSON.stringify(receipt.draft)))throw Error('保存回执与重新读取的修订不一致，请再次读取。');
}
