import {chatPoint,compareChatPoints} from '../../src/chat-candidate/export-page.ts';
import type {ChatPageWindow} from '../../src/chat-candidate/contracts.ts';
import type{ChatRepository,ChatTurn,ChatTransition}from'../../src/chat-candidate/contracts.ts';
import{checkedChatId,checkedChatLimit,checkedChatReservation,checkedChatTransition,checkedChatTurn,nextChatTurn,sameChatReservation}from'../../src/chat-candidate/repository.ts';
import{PlatformError}from'../../src/platform/domain.ts';

/** Synthetic in-process test store. Never used by the application runtime. */
export class MemoryChatRepository implements ChatRepository{
 readonly rows=new Map<string,{turn:ChatTurn;digest:string}>();
 async reserve(owner:string,proposed:ChatTurn,digest:string){
  const value=checkedChatReservation(owner,proposed,digest),key=JSON.stringify([owner,value.id]),old=this.rows.get(key);
  if(old){const turn=checkedChatTurn(owner,old.turn,value.id);sameChatReservation(turn,old.digest,value,digest);return{created:false,turn:structuredClone(turn)};}
  this.rows.set(key,{turn:structuredClone(value),digest});return{created:true,turn:structuredClone(value)};
 }
 async get(owner:string,id:string){checkedChatId(id);const value=this.rows.get(JSON.stringify([owner,id]));return value?checkedChatTurn(owner,structuredClone(value.turn),id):null;}
 async list(owner:string,limit:number){
  checkedChatLimit(limit);return[...this.rows.entries()].filter(([key])=>JSON.parse(key)[0]===owner).map(([,value])=>checkedChatTurn(owner,structuredClone(value.turn))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).slice(0,limit);
 }
 async page(owner:string,window:ChatPageWindow,limit:number){checkedChatLimit(limit);return [...this.rows.values()].map(v=>v.turn).filter(row=>row.ownerId===owner&&(!window.anchor||compareChatPoints(chatPoint(row),window.anchor)<=0)&&(!window.after||compareChatPoints(chatPoint(row),window.after)<0)).sort((a,b)=>-compareChatPoints(chatPoint(a),chatPoint(b))).slice(0,limit).map(row=>checkedChatTurn(owner,structuredClone(row)));}
 async transition(owner:string,id:string,expectedRevision:number,input:ChatTransition){
  checkedChatId(id);const change=checkedChatTransition(input),key=JSON.stringify([owner,id]),value=this.rows.get(key);
  if(!value)throw new PlatformError(404,'CHAT_TURN_NOT_FOUND','没有可访问的聊天记录。');
  const old=checkedChatTurn(owner,value.turn,id),turn=nextChatTurn(old,expectedRevision,change);
  if(old.state==='pending')this.rows.set(key,{...value,turn:structuredClone(turn)});return structuredClone(turn);
 }
}
