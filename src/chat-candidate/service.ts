import {chatPoint,compareChatPoints,encodeChatCursor,decodeChatCursor} from './export-page.ts';
import type {ChatPageExport} from './contracts.ts';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {PlatformError,object,validateId,validateRevision} from '../platform/domain.ts';
import {checkChatSignal,waitForChatSignal} from '../platform/ark-chat.ts';
import {checkedChatTurn} from './repository.ts';
import type {ChatRepository,ChatTurn,PublicChatTurn,ChatProviderSelector,ChatStatus,ChatHistory,ChatExport,ChatSendInput,ChatCancelInput,ChatStreamEvent,ChatState} from './contracts.ts';
const bad=():never=>{throw new PlatformError(400,'INVALID_CHAT_INPUT','请核对本轮文字、请求标识和合成范围确认。');};
const missing=():never=>{throw new PlatformError(404,'CHAT_TURN_NOT_FOUND','没有可访问的聊天回合。');};
const stored=():never=>{throw new PlatformError(503,'CHAT_STORAGE_UNAVAILABLE','聊天记录暂时无法读取。');};
const publicTurn=(turn:ChatTurn):PublicChatTurn=>{const{ownerId,...view}=structuredClone(turn);void ownerId;return view;};
const digest=(id:string,userText:string)=>createHash('sha256').update(JSON.stringify({turnId:id,userText,syntheticOnly:true,confirmSend:true})).digest('hex');
export function validateChatSend(input:unknown):ChatSendInput{
 try{const value=object(input,['turnId','userText','syntheticOnly','confirmSend']);if(value.syntheticOnly!==true||value.confirmSend!==true||typeof value.userText!=='string'||!value.userText.trim()||value.userText.length>16000||value.userText.includes('\0'))return bad();return{turnId:validateId(value.turnId),userText:value.userText,syntheticOnly:true,confirmSend:true};}catch{return bad();}
}
export function validateChatCancel(input:unknown):ChatCancelInput{
 try{const value=object(input,['expectedRevision','syntheticOnly']);if(value.syntheticOnly!==true)return bad();return{expectedRevision:validateRevision(value.expectedRevision),syntheticOnly:true};}catch{return bad();}
}
export const closedChatProviderSelector:ChatProviderSelector={async chatStatus(){return{available:false,mode:'unconfigured',provider:'volcengine-ark',model:null,configurationRevision:null,reason:'not-configured'};},async chatProvider(){return undefined;}};
const errorMessages:Record<string,string>={CHAT_CANCELLED:'本次生成已取消；已发送的请求仍可能产生费用。',CHAT_TIMEOUT:'本次生成超时，没有自动重试；请查看已保存状态。',CHAT_OUTPUT_LIMIT:'回答达到本次上限，未确认完整生成。',CHAT_CONFIGURATION_CHANGED:'配置已变化，本次回答未确认。',CHAT_EMPTY_RESPONSE:'服务未返回可用文字，没有自动重试。',CHAT_PROVIDER_UNAVAILABLE:'本次回答未完成，没有自动重试。',CHAT_PENDING_UNCONFIRMED:'这条回合尚无确认终态；不会再次生成，请查看原回合状态。',CHAT_FINALIZATION_UNCONFIRMED:'最终状态保存未确认；请回查同一回合，不要重复发送新请求。'};
function failure(cause:unknown,signal?:AbortSignal){
 const code=signal?.aborted?(signal.reason?.name==='TimeoutError'?'CHAT_TIMEOUT':'CHAT_CANCELLED'):cause instanceof PlatformError&&Object.hasOwn(errorMessages,cause.code)?cause.code:'CHAT_PROVIDER_UNAVAILABLE';return{code,message:errorMessages[code]};
}
function owned(owner:string,row:ChatTurn|null,id?:string):ChatTurn{
 if(!row||row.ownerId!==owner||id!==undefined&&row.id!==id)return missing();return checkedChatTurn(owner,row,id);
}
function terminalReceipt(previous:ChatTurn,row:ChatTurn):ChatTurn{
 if(row.state==='pending'||row.id!==previous.id||row.ownerId!==previous.ownerId||row.userText!==previous.userText||row.createdAt!==previous.createdAt||!isDeepStrictEqual(row.provenance,previous.provenance))return stored();return row;
}
export class ChatService{
 private repository:ChatRepository;private providers:ChatProviderSelector;private now:()=>Date;private active=new Map<string,AbortController>();
 constructor(repository:ChatRepository,providers:ChatProviderSelector=closedChatProviderSelector,now:()=>Date=()=>new Date()){this.repository=repository;this.providers=providers;this.now=now;}
 async status(owner:string):Promise<ChatStatus>{
  let capability;try{capability=await this.providers.chatStatus(owner);}catch{capability={available:false,mode:'unconfigured' as const,provider:'volcengine-ark' as const,model:null,configurationRevision:null,reason:'unavailable' as const};}
  return{...capability,storageReady:true,streaming:true,persistsTurns:true,dataScope:'current-message-only',sources:'not-connected',notice:capability.available?(capability.mode==='synthetic-sdk-test'?'仅 SDK 合成输运测试，不是真实模型；只发送本轮文字。':'只发送本轮文字；不读取历史或资料。请求发出后可能产生费用。'):'聊天模型尚未就绪；不会发送给外部模型。'};
 }
 async list(owner:string,includeSynthetic=false,limit=20):Promise<ChatHistory>{
  if(!Number.isInteger(limit)||limit<1||limit>50)throw new PlatformError(400,'INVALID_CHAT_QUERY','请核对聊天历史范围。');
  if(!includeSynthetic)return{items:[],limit,truncated:false,syntheticIncluded:false};
  const rows=await this.repository.list(owner,limit+1);if(!Array.isArray(rows))return stored();
  const safe=rows.filter(row=>row?.ownerId===owner).map(row=>checkedChatTurn(owner,row));const ids=new Set<string>();for(const row of safe){if(ids.has(row.id))return stored();ids.add(row.id);}
  return{items:safe.slice(0,limit).map(publicTurn),limit,truncated:safe.length>limit,syntheticIncluded:true};
 }
 /** One bounded repository read: no generation, mutation or current-settings lookup. */
 async export(owner:string,includeSynthetic:boolean):Promise<ChatExport>{
  if(includeSynthetic!==true)throw new PlatformError(400,'INVALID_CHAT_QUERY','请明确确认导出本账号的隔离聊天评审。');
  try{
   const rows=await this.repository.list(owner,51);if(!Array.isArray(rows)||rows.length>51)return stored();
   const safe=rows.map(row=>checkedChatTurn(owner,row)),ids=new Set<string>();
   for(let index=0;index<safe.length;index++){
    const row=safe[index],id=row.id.toLowerCase(),prior=safe[index-1];if(ids.has(id))return stored();ids.add(id);
    if(prior&&(Date.parse(prior.createdAt)<Date.parse(row.createdAt)||Date.parse(prior.createdAt)===Date.parse(row.createdAt)&&prior.id.toLowerCase()<id))return stored();
   }
   const exportedAt=this.now().toISOString();if(exportedAt.startsWith('0000-'))return stored();
   return{format:'lifeos.chat.export.v1',scope:'current-owner-isolated-review',exportedAt,selection:{limit:50,returnedTurns:Math.min(safe.length,50),truncated:safe.length>50,order:'createdAt-desc-id-desc',snapshot:'single-owner-list-read'},syntheticIncluded:true,serverCredentialsIncluded:false,backupOrRestoreVerified:false,contentSemantics:{userText:'original-user-input',assistantText:'generated-not-verified-facts'},items:safe.slice(0,50).map(publicTurn)};
  }catch{return stored();}
 }
 async exportPage(owner:string,includeSynthetic:boolean,cursor:string|null=null):Promise<ChatPageExport>{
  if(includeSynthetic!==true)throw new PlatformError(400,'INVALID_CHAT_QUERY','请明确确认合成评审范围。');
  const window=decodeChatCursor(owner,cursor);if(!this.repository.page)throw new PlatformError(503,'CHAT_PAGINATION_UNAVAILABLE','聊天存储尚不支持有界分页。');
  const rows=await this.repository.page(owner,window,51);if(!Array.isArray(rows)||rows.length>51)return stored();const safe=rows.map(row=>checkedChatTurn(owner,row)),ids=new Set<string>();
  for(let i=0;i<safe.length;i++){const point=chatPoint(safe[i]);if(ids.has(point.id)||window.anchor&&compareChatPoints(point,window.anchor)>0||window.after&&compareChatPoints(point,window.after)>=0||i>0&&compareChatPoints(chatPoint(safe[i-1]),point)<=0)return stored();ids.add(point.id);}
  const items=safe.slice(0,50),hasMore=safe.length>50,anchor=window.anchor??(safe[0]?chatPoint(safe[0]):null),after=items.at(-1)?chatPoint(items.at(-1)!):null;
  return{format:'lifeos.chat.export-page.v1',scope:'current-owner-isolated-review',exportedAt:this.now().toISOString(),selection:{limit:50,returnedTurns:items.length,truncated:hasMore,order:'createdAt-desc-id-desc',snapshot:'per-page-read-committed'},syntheticIncluded:true,serverCredentialsIncluded:false,backupOrRestoreVerified:false,contentSemantics:{userText:'original-user-input',assistantText:'generated-not-verified-facts'},items:items.map(publicTurn),page:{cursorUsed:cursor,nextCursor:hasMore?encodeChatCursor(owner,{anchor,after}):null,hasMore,snapshotConsistent:false,backdatedInsertionsMayBeMissed:true,revisionsMayChange:true,newerRowsRequireRestart:true}};
 }
 async get(owner:string,inputId:string,includeSynthetic=false):Promise<PublicChatTurn>{const id=validateId(inputId);if(!includeSynthetic)return missing();return publicTurn(owned(owner,await this.repository.get(owner,id),id));}
 async cancel(owner:string,inputId:string,input:unknown):Promise<PublicChatTurn>{
  const id=validateId(inputId),value=validateChatCancel(input),row=owned(owner,await this.repository.get(owner,id),id);
  if(row.state!=='pending')return publicTurn(row);
  const turn=terminalReceipt(row,owned(owner,await this.repository.transition(owner,id,value.expectedRevision,{state:'cancelled',assistantText:row.assistantText,errorCode:'CHAT_CANCELLED',updatedAt:this.now().toISOString()}),id));
  if(turn.state==='cancelled')this.active.get(JSON.stringify([owner,id]))?.abort();return publicTurn(turn);
 }
 async send(owner:string,input:unknown,requestSignal:AbortSignal=new AbortController().signal):Promise<AsyncIterable<ChatStreamEvent>>{
  const value=validateChatSend(input),id=value.turnId;checkChatSignal(requestSignal);
  const expectedDigest=digest(id,value.userText),prior=await this.repository.get(owner,id);checkChatSignal(requestSignal);
  if(prior){const found=owned(owner,prior,id);if(digest(id,found.userText)!==expectedDigest)throw new PlatformError(409,'CHAT_TURN_CONFLICT','这条请求标识已用于其他文字，请回查原回合。');return this.replay(found);}
  const provider=await waitForChatSignal(this.providers.chatProvider(owner),requestSignal);checkChatSignal(requestSignal);
  if(!provider)throw new PlatformError(503,'CHAT_NOT_CONFIGURED','聊天服务尚未启用，未发送给外部模型。');
  const at=this.now().toISOString(),proposed:ChatTurn={id,ownerId:owner,userText:value.userText,assistantText:'',state:'pending',revision:1,createdAt:at,updatedAt:at,provenance:provider.provenance,errorCode:null};checkedChatTurn(owner,proposed,id);
  const reservation=await this.repository.reserve(owner,proposed,expectedDigest),turn=owned(owner,reservation.turn,id);
  if(typeof reservation.created!=='boolean'||turn.userText!==value.userText)return stored();
  if(!reservation.created)return this.replay(turn);
  if(!isDeepStrictEqual(turn,proposed))return stored();
  const controller=new AbortController(),signal=AbortSignal.any([requestSignal,controller.signal,AbortSignal.timeout(30000)]),key=JSON.stringify([owner,id]);this.active.set(key,controller);
  let assistantText='',finalization:Promise<ChatTurn>|undefined;
  const finish=(state:Exclude<ChatState,'pending'>,code:string|null)=>finalization??=(async()=>{const saved=terminalReceipt(turn,owned(owner,await this.repository.transition(owner,id,1,{state,assistantText,errorCode:code,updatedAt:this.now().toISOString()}),id));if(saved.state==='completed'&&saved.assistantText!==assistantText)return stored();return saved;})();
  const abort=()=>{const error=failure(undefined,signal);if(this.active.get(key)===controller)this.active.delete(key);void finish(error.code==='CHAT_CANCELLED'?'cancelled':'failed',error.code).catch(()=>{});};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  const active=this.active;
  async function* events():AsyncGenerator<ChatStreamEvent>{
   let sequence=0,deltaCount=0;
   try{
    yield{type:'start',turnId:id,sequence:sequence++,turn:publicTurn(turn),replayed:false};
    checkChatSignal(signal);await provider!.assertCurrent(signal);checkChatSignal(signal);
    for await(const raw of provider!.stream(value.userText,signal)){
     checkChatSignal(signal);if(typeof raw!=='string'||raw.includes('\0'))throw Error('Invalid provider text');if(!raw)continue;
     if(assistantText.length+raw.length>32000)throw new PlatformError(503,'CHAT_OUTPUT_LIMIT',errorMessages.CHAT_OUTPUT_LIMIT);
     for(let offset=0;offset<raw.length;offset+=4096){if(++deltaCount>4096)throw new PlatformError(503,'CHAT_OUTPUT_LIMIT',errorMessages.CHAT_OUTPUT_LIMIT);const text=raw.slice(offset,offset+4096);assistantText+=text;yield{type:'delta',turnId:id,sequence:sequence++,text};checkChatSignal(signal);}
    }
    checkChatSignal(signal);await provider!.assertCurrent(signal);checkChatSignal(signal);if(!assistantText.trim())throw new PlatformError(503,'CHAT_EMPTY_RESPONSE',errorMessages.CHAT_EMPTY_RESPONSE);
    const saved=await finish('completed',null);if(saved.state==='failed'){const error=failure(new PlatformError(503,saved.errorCode??'CHAT_PROVIDER_UNAVAILABLE',''));yield{type:'error',turnId:id,sequence:sequence++,code:error.code,message:error.message,turn:publicTurn(saved)};}else yield{type:'done',turnId:id,sequence:sequence++,turn:publicTurn(saved),replayed:false};
   }catch(cause){
    const error=failure(cause,signal);try{const saved=await finish(error.code==='CHAT_CANCELLED'?'cancelled':'failed',error.code);if(saved.state==='cancelled'||saved.state==='completed')yield{type:'done',turnId:id,sequence:sequence++,turn:publicTurn(saved),replayed:false};else yield{type:'error',turnId:id,sequence:sequence++,code:error.code,message:error.message,turn:publicTurn(saved)};}
    catch{yield{type:'error',turnId:id,sequence:sequence++,code:'CHAT_FINALIZATION_UNCONFIRMED',message:errorMessages.CHAT_FINALIZATION_UNCONFIRMED,turn:null};}
   }finally{
    signal.removeEventListener('abort',abort);if(active.get(key)===controller)active.delete(key);
    if(!finalization){controller.abort();await finish('cancelled','CHAT_CANCELLED').catch(()=>{});}
    else await finalization.catch(()=>{});
   }
  }
  return events();
 }
 private async *replay(turn:ChatTurn):AsyncGenerator<ChatStreamEvent>{
  const view=publicTurn(turn);yield{type:'start',turnId:turn.id,sequence:0,turn:view,replayed:true};
  if(turn.state==='pending')yield{type:'error',turnId:turn.id,sequence:1,code:'CHAT_PENDING_UNCONFIRMED',message:errorMessages.CHAT_PENDING_UNCONFIRMED,turn:view};
  else if(turn.state==='failed'){const error=failure(new PlatformError(503,turn.errorCode??'CHAT_PROVIDER_UNAVAILABLE',''));yield{type:'error',turnId:turn.id,sequence:1,...error,turn:view};}
  else yield{type:'done',turnId:turn.id,sequence:1,turn:view,replayed:true};
 }
}
