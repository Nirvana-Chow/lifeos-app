import {symmetricDecrypt} from 'better-auth/crypto';
import type {PlatformAuth} from '../../src/platform/auth.ts';

/** Test-only browser cookie jar. Synthetic secrets remain inside the test process. */
export function mergeSyntheticAuthCookies(response:Response,previous=''):string{
 const jar=new Map(previous.split(';').map(value=>value.trim()).filter(Boolean).map(value=>{const at=value.indexOf('=');return[value.slice(0,at),value.slice(at+1)];}));
 for(const value of response.headers.getSetCookie()){const pair=value.split(';')[0],at=pair.indexOf('='),name=pair.slice(0,at),content=pair.slice(at+1);if(!content||/Max-Age=0(?:;|$)/i.test(value))jar.delete(name);else jar.set(name,content);}
 return[...jar].map(([name,value])=>name+'='+value).join('; ');
}
export async function syntheticOwnerTotp(auth:PlatformAuth,ownerId:string):Promise<string>{
 const context=await auth.$context;
 const factor=await context.adapter.findOne<{secret:string}>({model:'twoFactor',where:[{field:'userId',value:ownerId}]});
 if(!factor||typeof factor.secret!=='string')throw Error('Synthetic native factor missing');
 const secret=await symmetricDecrypt({key:context.secretConfig,data:factor.secret});
 if(secret.includes(':'))throw Error('Only newly generated synthetic native secrets are supported');
 return(await auth.api.generateTOTP({body:{secret}})).code;
}
export async function enrollSyntheticOwnerMfa(auth:PlatformAuth,ownerId:string,ownerPassword:string,request:(path:string,body:Record<string,unknown>,cookie:string)=>Promise<Response>,passwordCookie:string):Promise<{cookie:string;totpURI:string;backupCodes:string[]}>{
 const enabled=await request('two-factor/enable',{password:ownerPassword,method:'totp'},passwordCookie);
 if(enabled.status!==200)throw Error('Synthetic native MFA enable failed with HTTP '+enabled.status);
 const data=await enabled.json();
 if(typeof data.totpURI!=='string'||!Array.isArray(data.backupCodes)||data.backupCodes.some((value:unknown)=>typeof value!=='string'))throw Error('Synthetic native MFA response invalid');
 const cookie=mergeSyntheticAuthCookies(enabled,passwordCookie),code=await syntheticOwnerTotp(auth,ownerId),verified=await request('two-factor/verify-totp',{code},cookie);
 if(verified.status!==200)throw Error('Synthetic native MFA verification failed with HTTP '+verified.status);
 return{cookie:mergeSyntheticAuthCookies(verified,cookie),totpURI:data.totpURI,backupCodes:data.backupCodes};
}
