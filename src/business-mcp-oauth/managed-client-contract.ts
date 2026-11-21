import {allPersonalBusinessOAuthScope,fullBusinessOAuthScopes} from './scope-policy.ts';
export const managedChatGptClientId='https://lifeos.nirvanachow.com/oauth/clients/chatgpt';
export type ManagedClientCommand={callback:string;commandId:string};
export type ManagedClientReplaceCommand=ManagedClientCommand&{expectedRevision:string};
export type ManagedClientWriteCommand=ManagedClientCommand|ManagedClientReplaceCommand;
export function isManagedClientReplacement(command:ManagedClientWriteCommand):command is ManagedClientReplaceCommand{
 return 'expectedRevision' in command;
}
export const managedClientPath='/api/platform/business-mcp/client';
export const managedClientName='LifeOS ChatGPT';
export const managedClientVersion='chatgpt-v1';
export function validManagedCallback(value:unknown):value is string{return typeof value==='string'&&/^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{8,128}$/.test(value)&&!/[\r\n]/.test(value);}
export function validManagedCommandId(value:unknown):value is string{
 return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
export function parseManagedClientCommand(value:unknown):ManagedClientCommand|null{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||!Object.hasOwn(value,'callback')||!Object.hasOwn(value,'commandId'))return null;
 const data=value as Record<string,unknown>;
 return validManagedCallback(data.callback)&&validManagedCommandId(data.commandId)?{callback:data.callback,commandId:data.commandId}:null;
}
export function parseManagedClientWriteCommand(value:unknown):ManagedClientWriteCommand|null{
 if(!value||typeof value!=='object'||!Object.hasOwn(value,'expectedRevision'))return parseManagedClientCommand(value);
 if(Array.isArray(value)||Object.keys(value).length!==3)return null;
 const {expectedRevision,...rest}=value as Record<string,unknown>;
 const command=parseManagedClientCommand(rest);
 return command&&validManagedCommandId(expectedRevision)&&command.commandId!==expectedRevision?{...command,expectedRevision}:null;
}
export type ManagedClientState={registered:false}|({registered:true;revision?:string}&ManagedClientCommand);
export type ManagedClientSetup={clientId:string;authorizationEndpoint:string;tokenEndpoint:string;resource:string;scopes:string[];tokenEndpointAuthMethod:'none';codeChallengeMethod:'S256'}&ManagedClientState;
function validManagedScopes(value:unknown):value is string[]{
 if(!Array.isArray(value)||value.length===0||value.length>64)return false;
 if(value.includes(allPersonalBusinessOAuthScope))return fullBusinessOAuthScopes(value);
 return new Set(value).size===value.length&&value.every(scope=>typeof scope==='string'&&/^(offline_access|[a-z][a-z0-9-]*:(read|write))$/.test(scope));
}

export function readManagedClientSetup(value:unknown):ManagedClientSetup|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const r=value as Record<string,unknown>,keys=['clientId','authorizationEndpoint','tokenEndpoint','resource','scopes','tokenEndpointAuthMethod','codeChallengeMethod','registered',...(r.registered===true?['callback','commandId',...(Object.hasOwn(r,'revision')?['revision']:[])]:[])];
 if(Object.keys(r).length!==keys.length||Object.keys(r).some(key=>!keys.includes(key))||r.clientId!==managedChatGptClientId||r.authorizationEndpoint!=='https://lifeos.nirvanachow.com/api/platform/auth/oauth2/authorize'||r.tokenEndpoint!=='https://lifeos.nirvanachow.com/api/platform/auth/oauth2/token'||r.resource!=='https://lifeos.nirvanachow.com/api/platform/mcp'||r.tokenEndpointAuthMethod!=='none'||r.codeChallengeMethod!=='S256'||![true,false].includes(r.registered as boolean)||!validManagedScopes(r.scopes))return null;
 if(r.registered===true&&(!parseManagedClientCommand({callback:r.callback,commandId:r.commandId})||Object.hasOwn(r,'revision')&&!validManagedCommandId(r.revision)))return null;
 return r as ManagedClientSetup;
}
