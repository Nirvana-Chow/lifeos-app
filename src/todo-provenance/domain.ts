export const expressionTypes = ['written','spoken'] as const;
export type ExpressionType = typeof expressionTypes[number];
export type CaptureChannel = 'owner-web'|'agent-api';
export type TodoCapture = {version:1;channel:CaptureChannel;expression:ExpressionType|null};
export const expressionLabels:Record<ExpressionType,string>={written:'书面表达',spoken:'口述表达'};
export const channelLabels:Record<CaptureChannel,string>={'owner-web':'本人网页','agent-api':'获准 Agent API'};
const objectValue=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

export function isExpressionType(value:unknown):value is ExpressionType {
 return expressionTypes.some(type=>type===value);
}

/** Only recognize explicit evidence on the immutable, typed Todo source envelope. */
export function todoCapture(original:unknown):TodoCapture|null{
 if(!objectValue(original)||original.marker!=='personal-manual-v1'||original.type!=='todo'||!objectValue(original.input))return null;
 const value=original.capture;
 if(!objectValue(value)||Object.keys(value).length!==3||value.version!==1||
    (value.channel!=='owner-web'&&value.channel!=='agent-api')||
    (value.expression!==null&&!isExpressionType(value.expression))||
    value.expression!==(Object.hasOwn(original.input,'expression')?original.input.expression:null))return null;
 return {version:1,channel:value.channel,expression:value.expression};
}

export function captureLabels(original:unknown){
 const capture=todoCapture(original);
 return {channel:capture?channelLabels[capture.channel]:'未知',
  expression:capture?.expression?expressionLabels[capture.expression]:'未知'};
}

export function manualSourceKeys(type:string){return ['marker','spaceId','type','input',...(type==='todo'?['capture']:[])];}

export function pinnedInboxOrigin(original:unknown,inboxId:string|undefined){
 if(!inboxId||!objectValue(original)||!objectValue(original.originInbox))return null;
 const {id,sourceId,revision}=original.originInbox;
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(typeof id!=='string'||id!==inboxId||!uuid.test(id)||typeof sourceId!=='string'||!uuid.test(sourceId)||
    typeof revision!=='number'||!Number.isInteger(revision)||revision<1||revision>2147483647)return null;
 return {id,sourceId,revision};
}
