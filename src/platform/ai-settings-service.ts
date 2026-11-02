import{z}from'zod';import{PlatformError}from'./domain.ts';import{isHTTPSOrigin}from'./config.ts';
import{saveAIConfigSchema,aiTestSchema,aiActivationSchema,aiRevisionSchema,type PublicAISettings}from'./ai-settings-contract.ts';
import{aiSecretSchema,type AISecretVault}from'./ai-secret-vault.ts';
import type{AISettingsRepository,AISettingsRow,AIMode}from'./ai-settings-repository.ts';
import{createArkCaptureExtractor}from'./ark-capture.ts';import{checkCaptureSignal,waitForCaptureSignal,type CaptureExtractor}from'./capture.ts';
import{createArkChatProvider,checkChatSignal,waitForChatSignal}from'./ark-chat.ts';
import type{ChatCapability,ChatProvider}from'../chat-candidate/contracts.ts';
type Options={baseURL:string;externalCallsApproved:boolean;dataTransmissionApproved:boolean;callBudgetApproved:boolean;syntheticTransport?:typeof fetch;now?:()=>Date};
const parsed=<T>(schema:z.ZodType<T>,value:unknown):T=>{const result=schema.safeParse(value);if(!result.success)throw new PlatformError(400,'INVALID_AI_SETTINGS','请核对配置字段、版本和确认选项。');return result.data;};
const reset={enabled:false,testState:'never' as const,testedMaterialRevision:null,testMode:null,testStartedAt:null,testedAt:null};
export class AISettingsService{
 private repository:AISettingsRepository;private vault:AISecretVault|null;private options:Options;
 constructor(repository:AISettingsRepository,vault:AISecretVault|null,options:Options){this.repository=repository;this.vault=vault;this.options=options;}
 private now(){return(this.options.now?.()??new Date()).toISOString();}
 private get secure(){try{return isHTTPSOrigin(new URL(this.options.baseURL));}catch{return false;}}
 private get mode():AIMode|null{return this.options.syntheticTransport?'synthetic-sdk-test':this.options.externalCallsApproved&&this.options.dataTransmissionApproved&&this.options.callBudgetApproved?'approved-live':null;}
 private canCall(){return this.secure&&!!this.vault&&!!this.mode;}
 private owned(owner:string,row:AISettingsRow|null):AISettingsRow{if(!row||row.ownerId!==owner)throw new PlatformError(404,'AI_SETTINGS_NOT_FOUND','请先保存服务配置。');return row;}
 private increment(n:number){if(n>=2147483646)throw new PlatformError(409,'AI_SETTINGS_VERSION_LIMIT','配置版本已达上限。');return n+1;}
 private public(row:AISettingsRow|null):PublicAISettings{
  const tested=!!row&&row.testState==='passed'&&row.testedMaterialRevision===row.materialRevision&&row.testMode===this.mode;
  return{storage:'ready',revision:row?.revision??0,config:row?structuredClone(row.config):null,secretState:row?.secret?'stored':'not-set',secretMask:row?.secret?'••••••••':null,enabled:!!row?.enabled&&tested&&this.canCall(),realModelActive:!!row?.enabled&&tested&&this.canCall()&&this.mode==='approved-live',mode:this.mode??'unconfigured',testState:row?.testState??'never',testedAt:row?.testedAt??null,capabilities:{configurationWritable:true,secretWritable:this.secure&&!!this.vault,connectionTestAvailable:this.canCall()&&!!row?.secret,activationAvailable:this.canCall()&&tested},notice:!this.secure?'当前入口不接收密钥；需核验安全 HTTPS。':!this.vault?'秘密存储尚未配置。':!this.mode?'配置保存不会调用模型；外部调用尚未获准。':this.mode==='synthetic-sdk-test'?'仅合成输运测试，不是真实模型。':'测试连接可能产生费用。月预算目前仅记录，不是自动硬上限。'};
 }
 async view(owner:string){const row=await this.repository.get(owner);if(row&&row.ownerId!==owner)throw new PlatformError(404,'AI_SETTINGS_NOT_FOUND','没有对应配置。');return this.public(row);}
 async saveConfig(owner:string,input:unknown){const value=parsed(saveAIConfigSchema,input),now=this.now();const row=await this.repository.change(owner,value.expectedRevision,old=>({ownerId:owner,revision:this.increment(old?.revision??0),materialRevision:this.increment(old?.materialRevision??0),config:value.config,secret:old?.secret??null,...reset,updatedAt:now}));return this.public(row);}
 async saveSecret(owner:string,input:unknown){
  if(!this.secure||!this.vault)throw new PlatformError(503,'AI_SECRET_ENTRY_UNAVAILABLE','当前入口或秘密存储未就绪，不接收 API key。');
  const value=parsed(z.strictObject({expectedRevision:aiRevisionSchema,secret:aiSecretSchema}),input),vault=this.vault;
  const row=await this.repository.change(owner,value.expectedRevision,old=>{const r=this.owned(owner,old);return{...r,revision:this.increment(r.revision),materialRevision:this.increment(r.materialRevision),secret:vault.seal(owner,r.config.provider,value.secret),...reset,updatedAt:this.now()};});return this.public(row);
 }
 async removeSecret(owner:string,input:unknown){const value=parsed(z.strictObject({expectedRevision:aiRevisionSchema}),input),row=await this.repository.change(owner,value.expectedRevision,old=>{const r=this.owned(owner,old);return{...r,revision:this.increment(r.revision),materialRevision:this.increment(r.materialRevision),secret:null,...reset,updatedAt:this.now()};});return this.public(row);}
 private extractor(owner:string,row:AISettingsRow,pending=false):CaptureExtractor{
  const mode=this.mode;if(!this.canCall()||!row.secret||!mode)throw new PlatformError(503,'AI_CALLS_NOT_APPROVED','模型、数据范围或费用尚未获准。');
  const current=async(signal?:AbortSignal)=>{checkCaptureSignal(signal);const work=this.repository.get(owner),latest=await(signal?waitForCaptureSignal(work,signal):work);checkCaptureSignal(signal);if(!latest||latest.ownerId!==owner||latest.revision!==row.revision||latest.materialRevision!==row.materialRevision||!latest.secret||!this.canCall()||(pending?latest.testState!=='pending':!this.public(latest).enabled))throw new PlatformError(409,'CAPTURE_CONFIGURATION_CHANGED','模型配置已变化，请重新读取配置后再预填；尚未保存记录。');return latest;};
  const assertCurrent=async(signal:AbortSignal)=>{await current(signal);};
  const getSecret=async(signal?:AbortSignal)=>{const latest=await current(signal);checkCaptureSignal(signal);return this.vault!.open(owner,latest.config.provider,latest.secret!);};
  const extractor=this.options.syntheticTransport?createArkCaptureExtractor(row.config,{mode:'synthetic-sdk-test',getSecret,assertCurrent,fetch:this.options.syntheticTransport}):createArkCaptureExtractor(row.config,{mode:'approved-live',getSecret,assertCurrent,externalCallsApproved:true,dataTransmissionApproved:true,callBudgetApproved:true});
  const selected={...extractor,provenance:{provider:row.config.provider,model:row.config.model,configurationRevision:row.revision,materialRevision:row.materialRevision,mode}};return selected;
 }
 async testConnection(owner:string,input:unknown,context:{signal?:AbortSignal}={}){
  checkCaptureSignal(context.signal);
  const value=parsed(aiTestSchema,input);if(!this.canCall())throw new PlatformError(503,'AI_CALLS_NOT_APPROVED','尚未批准模型连接测试。');
  const pending=await this.repository.change(owner,value.expectedRevision,old=>{checkCaptureSignal(context.signal);const r=this.owned(owner,old);if(!r.secret)throw new PlatformError(409,'AI_SECRET_REQUIRED','请先保存密钥。');if(r.testState==='pending'&&r.testStartedAt&&Date.parse(this.now())-Date.parse(r.testStartedAt)<30000)throw new PlatformError(409,'AI_TEST_BUSY','上次测试尚未确认，请先等待并重新读取。');return{...r,...reset,revision:this.increment(r.revision),testState:'pending',testStartedAt:this.now(),updatedAt:this.now()};});
  try{await this.extractor(owner,pending,true).extract({text:'【连接测试，无私人资料】返回标题“连接测试”、正文“测试”、日期null。',kind:'life',timeZone:'UTC',adapter:'ai'},{referenceDate:this.now().slice(0,10),signal:context.signal});checkCaptureSignal(context.signal);}catch(cause){
   await this.repository.change(owner,pending.revision,old=>{const r=this.owned(owner,old);return{...r,revision:this.increment(r.revision),testState:'failed',enabled:false,updatedAt:this.now()};}).catch(()=>undefined);
   if(cause instanceof PlatformError&&cause.code==='CAPTURE_CONFIGURATION_CHANGED')throw new PlatformError(409,'AI_SETTINGS_CONFLICT','配置已更新，请重新读取。');
   throw new PlatformError(503,'AI_CONNECTION_TEST_FAILED','连接测试未确认成功，服务保持停用；重试可能再次计费。');
  }
  const row=await this.repository.change(owner,pending.revision,old=>{checkCaptureSignal(context.signal);const r=this.owned(owner,old);return{...r,revision:this.increment(r.revision),testState:'passed',testedMaterialRevision:r.materialRevision,testMode:this.mode,testedAt:this.now(),updatedAt:this.now()};});return this.public(row);
 }
 async activate(owner:string,input:unknown){const value=parsed(aiActivationSchema,input),row=await this.repository.change(owner,value.expectedRevision,old=>{const r=this.owned(owner,old);if(value.enabled&&(!this.canCall()||!r.secret||r.testState!=='passed'||r.testedMaterialRevision!==r.materialRevision||r.testMode!==this.mode))throw new PlatformError(409,'AI_NOT_READY','请先完成当前配置的连接测试及费用授权。');return{...r,revision:this.increment(r.revision),enabled:value.enabled,updatedAt:this.now()};});return this.public(row);}
 async captureExtractor(owner:string):Promise<CaptureExtractor|undefined>{const row=await this.repository.get(owner);if(!row||!this.public(row).enabled)return undefined;return this.extractor(owner,this.owned(owner,row));}
 async chatStatus(owner:string):Promise<ChatCapability>{
  const row=await this.repository.get(owner);if(row)this.owned(owner,row);const view=this.public(row);
  return{available:view.enabled,mode:view.enabled&&this.mode?this.mode:'unconfigured',provider:'volcengine-ark',model:row?.config.model??null,configurationRevision:row?.revision??null,reason:view.enabled?'ready':row?'disabled':'not-configured'};
 }
 async chatProvider(owner:string):Promise<ChatProvider|undefined>{
  const row=await this.repository.get(owner);if(!row)return undefined;this.owned(owner,row);if(!this.public(row).enabled||!this.mode)return undefined;
  const current=async()=>{const latest=this.owned(owner,await this.repository.get(owner));if(latest.revision!==row.revision||latest.materialRevision!==row.materialRevision||!this.public(latest).enabled||!latest.secret)throw new PlatformError(409,'CHAT_CONFIGURATION_CHANGED','配置已变化，请重新核对。');return latest;};
  const assertCurrent=async(signal:AbortSignal)=>{checkChatSignal(signal);await waitForChatSignal(current(),signal);};
  const getSecret=async()=>{const latest=await current();return this.vault!.open(owner,latest.config.provider,latest.secret!);};
  const provenance={provider:row.config.provider,model:row.config.model,configurationRevision:row.revision,materialRevision:row.materialRevision,mode:this.mode,dataScope:row.config.dataScope,sources:'not-connected' as const};
  return this.options.syntheticTransport?createArkChatProvider(row.config,provenance,{mode:'synthetic-sdk-test',getSecret,assertCurrent,fetch:this.options.syntheticTransport}):createArkChatProvider(row.config,provenance,{mode:'approved-live',getSecret,assertCurrent,externalCallsApproved:true,dataTransmissionApproved:true,callBudgetApproved:true});
 }
}
