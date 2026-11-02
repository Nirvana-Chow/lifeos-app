import type{PublicEntry}from'../platform/contracts.ts';import type{PersonalType}from'./config.ts';import{originalPersonalType}from'./apple-origin.ts';
export function requestedDetailKey(binding:{ownerId:string;spaceId:string},type:PersonalType,id?:string){return JSON.stringify([binding.ownerId,binding.spaceId,type,id??null]);}
/** Resolve each URL request once per owner/space/type/ID; locked requests wait. */
export function resolveDetailNavigation(input:{binding:{ownerId:string;spaceId:string};type:PersonalType;id?:string;processed:string|null;records:PublicEntry[]|null;locked:boolean}){
 const key=requestedDetailKey(input.binding,input.type,input.id);if(input.processed===key)return{action:'done' as const,key};if(input.locked||input.records===null)return{action:'wait' as const,key};if(!input.id)return{action:'new' as const,key};const entry=input.records.find(e=>e.id===input.id&&(e.source.original as {spaceId?:string}).spaceId===input.binding.spaceId&&originalPersonalType(e.source.original)===input.type);return entry?{action:'select' as const,key,entry}:{action:'missing' as const,key};
}
