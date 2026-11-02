import{z}from'zod';
import{PlatformError}from'../platform/domain.ts';
import type{ChatTurn,ChatTransition}from'./contracts.ts';
export type{ChatRepository}from'./contracts.ts';

const text=(max:number)=>z.string().max(max).refine(value=>!value.includes('\0'));
const errorCode=z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).nullable();
const revision=z.number().int().min(1).max(2147483646);
const timestamp=z.iso.datetime().refine(value=>!value.startsWith('0000-'));
const provenance=z.strictObject({provider:z.literal('volcengine-ark'),model:z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/),configurationRevision:revision,materialRevision:revision,mode:z.enum(['synthetic-sdk-test','approved-live']),dataScope:z.literal('current-message-only'),sources:z.literal('not-connected')});
const turnSchema=z.strictObject({id:z.uuid(),ownerId:z.string().min(1).max(256),userText:text(16000).refine(value=>value.trim().length>0),assistantText:text(32000),state:z.enum(['pending','completed','failed','cancelled']),revision:z.number().int().min(1).max(2),createdAt:timestamp,updatedAt:timestamp,provenance,errorCode})
 .refine(value=>Date.parse(value.updatedAt)>=Date.parse(value.createdAt))
 .refine(value=>value.state==='pending'?value.revision===1&&value.assistantText===''&&value.errorCode===null&&value.updatedAt===value.createdAt:value.revision===2&&(value.state!=='completed'||value.errorCode===null));
const transitionSchema=z.strictObject({state:z.enum(['completed','failed','cancelled']),assistantText:text(32000),errorCode,updatedAt:timestamp}).refine(value=>value.state!=='completed'||value.errorCode===null);

/** Validation also rejects malicious adapter rows before they reach a public DTO. */
export function checkedChatTurn(owner:string,value:unknown,expectedId?:string):ChatTurn{
 const parsed=turnSchema.safeParse(value);
 if(!parsed.success||parsed.data.ownerId!==owner||(expectedId!==undefined&&parsed.data.id!==expectedId))throw new PlatformError(503,'CHAT_STORAGE_UNAVAILABLE','聊天记录暂时无法读取。');
 return parsed.data;
}
export function checkedChatReservation(owner:string,value:unknown,digest:string):ChatTurn{
 const turn=checkedChatTurn(owner,value);
 if(turn.state!=='pending'||!/^[0-9a-f]{64}$/.test(digest))throw new PlatformError(400,'CHAT_INVALID_TURN','聊天请求无效。');
 return turn;
}
export function checkedChatId(id:string):void{if(!z.uuid().safeParse(id).success)throw new PlatformError(400,'CHAT_INVALID_TURN','聊天请求无效。');}
export function checkedChatLimit(limit:number):void{if(!Number.isInteger(limit)||limit<1||limit>51)throw new PlatformError(400,'CHAT_INVALID_HISTORY_QUERY','聊天历史读取范围无效。');}
export function checkedChatTransition(value:unknown):ChatTransition{
 const parsed=transitionSchema.safeParse(value);if(!parsed.success)throw new PlatformError(400,'CHAT_INVALID_TRANSITION','聊天状态变更无效。');return parsed.data;
}
export function nextChatTurn(previous:ChatTurn,expectedRevision:number,change:ChatTransition):ChatTurn{
 if(previous.state!=='pending')return previous;
 if(previous.revision!==expectedRevision)throw new PlatformError(409,'CHAT_REVISION_CONFLICT','聊天状态已变化，请重新读取。');
 if(Date.parse(change.updatedAt)<Date.parse(previous.updatedAt))throw new PlatformError(400,'CHAT_INVALID_TRANSITION','聊天状态变更无效。');
 return checkedChatTurn(previous.ownerId,{...previous,...change,revision:previous.revision+1},previous.id);
}
export function sameChatReservation(previous:ChatTurn,storedDigest:unknown,proposed:ChatTurn,digest:string):void{
 if(storedDigest!==digest||previous.userText!==proposed.userText)throw new PlatformError(409,'CHAT_TURN_CONFLICT','这条聊天请求已保存其他输入，请重新读取。');
}
