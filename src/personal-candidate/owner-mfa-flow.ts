export type MfaSetup={uri:string;secret:string;backupCodes:string[]};
/** Only a same-origin native response reaches this parser; never persist its output. */
export function parseMfaSetup(input:unknown):MfaSetup{
 const fail=():never=>{throw Error('绑定信息无效，请重新登录后再试。');};
 if(!input||typeof input!=='object')return fail();const value=input as Record<string,unknown>;
 if(value.method!=='totp'||typeof value.totpURI!=='string'||value.totpURI.length>2048)return fail();
 let url:URL;try{url=new URL(value.totpURI);}catch{return fail();}
 const secret=url.searchParams.get('secret');
 if(url.protocol!=='otpauth:'||url.hostname!=='totp'||url.username||url.password||url.hash||!secret||!/^[A-Z2-7]{16,256}$/.test(secret)||url.searchParams.getAll('secret').length!==1||url.searchParams.get('issuer')!=='LifeOS'||(url.searchParams.has('digits')&&url.searchParams.get('digits')!=='6')||(url.searchParams.has('period')&&url.searchParams.get('period')!=='30')||(url.searchParams.has('algorithm')&&url.searchParams.get('algorithm')!=='SHA1'))return fail();
 if(!Array.isArray(value.backupCodes)||value.backupCodes.length<1||value.backupCodes.length>20||value.backupCodes.some(code=>typeof code!=='string'||!code||code.length>128))return fail();
 return{uri:value.totpURI,secret,backupCodes:value.backupCodes as string[]};
}
export function passwordLoginDestination(input:unknown,personal:boolean):'challenge'|'/account/mfa'|'/review/admin'{
 if(input&&typeof input==='object'&&(input as Record<string,unknown>).twoFactorRedirect===true)return'challenge';
 return personal?'/account/mfa':'/review/admin';
}
