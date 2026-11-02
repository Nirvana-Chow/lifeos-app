import{createCipheriv,createDecipheriv,randomBytes}from'node:crypto';
import{z}from'zod';import{readPrivateObject}from'./private-config.ts';import{PlatformError}from'./domain.ts';
import{aiSecretInputSchema}from'./ai-settings-contract.ts';
const base64=z.string().max(16384).refine(v=>Buffer.from(v,'base64').toString('base64')===v);
const envelopeSchema=z.strictObject({version:z.literal(1),keyId:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),iv:base64,tag:base64,ciphertext:base64});
export type EncryptedAISecret=z.infer<typeof envelopeSchema>;
export interface AISecretVault{seal(owner:string,provider:string,secret:string):EncryptedAISecret;open(owner:string,provider:string,value:EncryptedAISecret):string}
export const aiSecretSchema=aiSecretInputSchema;
const unavailable=()=>new PlatformError(503,'AI_SECRET_STORE_UNAVAILABLE','AI 秘密存储暂不可用。');
export function createAISecretVault(master:{keyId:string;key:Uint8Array}):AISecretVault{
 if(!/^[A-Za-z0-9_-]{1,64}$/.test(master.keyId)||master.key.byteLength!==32)throw unavailable();
 const key=Buffer.from(master.key),aad=(owner:string,provider:string)=>Buffer.from(JSON.stringify({version:1,owner,provider,keyId:master.keyId}));
 return{
  seal(owner,provider,value){try{const secret=aiSecretSchema.parse(value),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad(owner,provider));const ciphertext=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return{version:1,keyId:master.keyId,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};}catch{throw unavailable();}},
  open(owner,provider,value){try{const sealed=envelopeSchema.parse(value);if(sealed.keyId!==master.keyId||Buffer.from(sealed.iv,'base64').length!==12||Buffer.from(sealed.tag,'base64').length!==16)throw Error();const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(sealed.iv,'base64'));cipher.setAAD(aad(owner,provider));cipher.setAuthTag(Buffer.from(sealed.tag,'base64'));return aiSecretSchema.parse(Buffer.concat([cipher.update(Buffer.from(sealed.ciphertext,'base64')),cipher.final()]).toString('utf8'));}catch{throw unavailable();}},
 };
}
export function loadAISecretVault(path:string):AISecretVault{
 try{const value=z.strictObject({version:z.literal(1),keyId:envelopeSchema.shape.keyId,key:base64}).parse(readPrivateObject(path)),key=Buffer.from(value.key,'base64');if(key.length!==32)throw Error();return createAISecretVault({keyId:value.keyId,key});}catch{throw unavailable();}
}
