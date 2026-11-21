import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';

const generationContext=new AsyncLocalStorage<string|null>();

export function withManagedCredentialGeneration<T>(generation:string|null,run:()=>T):T{
 return generationContext.run(generation,run);
}

/** The SDK's default digest remains byte-identical for other clients and existing registrations. */
export function hashOAuthCredential(token:string,type:string):string{
 const generation=generationContext.getStore();
 const hash=createHash('sha256');
 if(generation&&(type==='authorization_code'||type==='refresh_token')){
  hash.update('lifeos-managed-chatgpt-v1\0'+generation+'\0'+type+'\0');
 }
 return hash.update(token).digest('base64url');
}
