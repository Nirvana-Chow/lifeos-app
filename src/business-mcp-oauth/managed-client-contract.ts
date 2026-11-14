export const managedChatGptClientId='https://lifeos.nirvanachow.com/oauth/clients/chatgpt';
export type ManagedClientCommand={callback:string;commandId:string};
export const managedClientPath='/api/platform/business-mcp/client';
export const managedClientName='LifeOS ChatGPT';
export const managedClientVersion='chatgpt-v1';
export function validManagedCallback(value:unknown):value is string{return typeof value==='string'&&/^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{8,128}$/.test(value)&&!/[\r\n]/.test(value);}
export function parseManagedClientCommand(value:unknown):ManagedClientCommand|null{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||!Object.hasOwn(value,'callback')||!Object.hasOwn(value,'commandId'))return null;
 const data=value as Record<string,unknown>;
 return validManagedCallback(data.callback)&&typeof data.commandId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(data.commandId)?{callback:data.callback,commandId:data.commandId}:null;
}
export type ManagedClientState={registered:false}|({registered:true}&ManagedClientCommand);
export type ManagedClientSetup={clientId:string;authorizationEndpoint:string;tokenEndpoint:string;resource:string;scopes:string[];tokenEndpointAuthMethod:'none';codeChallengeMethod:'S256'}&ManagedClientState;
export function readManagedClientSetup(value:unknown):ManagedClientSetup|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const r=value as Record<string,unknown>,keys=['clientId','authorizationEndpoint','tokenEndpoint','resource','scopes','tokenEndpointAuthMethod','codeChallengeMethod','registered',...(r.registered===true?['callback','commandId']:[])];
 if(Object.keys(r).length!==keys.length||Object.keys(r).some(key=>!keys.includes(key))||r.clientId!==managedChatGptClientId||r.authorizationEndpoint!=='https://lifeos.nirvanachow.com/api/platform/auth/oauth2/authorize'||r.tokenEndpoint!=='https://lifeos.nirvanachow.com/api/platform/auth/oauth2/token'||r.resource!=='https://lifeos.nirvanachow.com/api/platform/mcp'||r.tokenEndpointAuthMethod!=='none'||r.codeChallengeMethod!=='S256'||![true,false].includes(r.registered as boolean)||!Array.isArray(r.scopes)||r.scopes.length<1||r.scopes.length>64||new Set(r.scopes).size!==r.scopes.length||!r.scopes.every(scope=>typeof scope==='string'&&/^(offline_access|[a-z][a-z0-9-]*:(read|write))$/.test(scope)))return null;
 if(r.registered===true&&!parseManagedClientCommand({callback:r.callback,commandId:r.commandId}))return null;
 return r as ManagedClientSetup;
}
