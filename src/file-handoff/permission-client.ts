import {filePermissionChangeSchema,filePermissionStateSchema} from './permission-contracts.ts';
export function permissionReadback(input:unknown,value:unknown):'unknown'|'observed'|'conflict'|'stopped'{
 const pending=filePermissionChangeSchema.parse(input),grant=value as {id?:string;status?:string;grantDigest?:string;fileHandoff?:unknown};
 if(grant.id!==pending.id)throw Error('FILE_PERMISSION_IDENTITY_INVALID');
 if(grant.status==='revoked'||grant.status==='expired')return 'stopped';if(grant.status!=='active')throw Error('FILE_PERMISSION_STATE_INVALID');
 const parsed=filePermissionStateSchema.safeParse(grant.fileHandoff),revision=parsed.success?parsed.data.revision:0;
 const scopes=parsed.success?parsed.data.scopes:[],consumer=parsed.success?parsed.data.consumer:null;
 if(revision===pending.expectedFileRevision&&grant.grantDigest===pending.expectedGrantDigest&&consumer===pending.consumer&&JSON.stringify(scopes)===JSON.stringify(pending.scopes))return 'observed';
 if(revision<=pending.expectedFileRevision)return grant.grantDigest!==pending.expectedGrantDigest?'conflict':'unknown';
 return revision===pending.expectedFileRevision+1&&parsed.success&&parsed.data.consumer===pending.consumer&&JSON.stringify(parsed.data.scopes)===JSON.stringify(pending.scopes)?'observed':'conflict';
}
export async function readManagedFileGrant(id:string,fetcher:typeof fetch=fetch){
 let cursor:string|undefined;const seen=new Set<string>();
 for(let page=0;page<100;page++){
  const response=await fetcher('/api/platform/account/api-keys'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{credentials:'same-origin',cache:'no-store',redirect:'error'});
  if(!response.ok)throw Error('FILE_PERMISSION_READ_UNAVAILABLE');const value=await response.json();if(!Array.isArray(value.keys)||value.keys.length>100)throw Error('FILE_PERMISSION_READ_INVALID');
  const found=value.keys.find((grant:{id?:unknown})=>grant.id===id);if(found)return found;
  if(typeof value.nextCursor!=='string'||!value.nextCursor||seen.has(value.nextCursor))throw Error('FILE_PERMISSION_NOT_FOUND');seen.add(value.nextCursor);cursor=value.nextCursor;
 }throw Error('FILE_PERMISSION_READ_INCOMPLETE');
}
