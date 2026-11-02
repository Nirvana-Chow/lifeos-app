// Compatibility status projection; actual chat shares the owner-scoped AI settings service.
import {PlatformError} from './domain.ts';
import type {PublicAISettings} from './ai-settings-contract.ts';
export function aiStatus(settings?:PublicAISettings){return{
 configured:settings?.realModelActive??false,externalCallsEnabled:settings?.realModelActive??false,configurationWritable:settings?.capabilities.configurationWritable??false,
 sdk:{name:'ai',version:'7.0.150',compatibleProviderVersion:'3.0.77',binding:settings?.enabled?'active-candidate':'prepared-not-activated'},
 provider:{id:'volcengine-ark',label:'火山引擎方舟',baseURL:'https://ark.cn-beijing.volces.com/api/v3',model:settings?.config?.model??null,keyState:settings?.secretState==='stored'?'stored-masked':'not_provided'},
 scope:{read:'current-message-only',tools:false,automaticSave:false},budget:{approved:settings?.realModelActive??false,limit:settings?.config?.monthlyBudgetMinor??null,unit:'CNY-minor',hardLimitEnforced:false},
 configurationFields:['provider','baseURL','model','serverSecretReference','budget','dataScope'],protocol:'openai-compatible-chat-completions',
 notice:settings?.notice??'AI 尚未配置。密钥、模型、数据范围和费用需另行确认。',
};}
export function aiUnavailable():never{throw new PlatformError(503,'AI_NOT_CONFIGURED','AI 尚未配置，未发送给外部模型。可以改用手工整理。');}
