import type{PublicAIConfig}from'./ai-settings-contract.ts';import type{EncryptedAISecret}from'./ai-secret-vault.ts';
export type AIMode='synthetic-sdk-test'|'approved-live';
export type AISettingsRow={ownerId:string;revision:number;materialRevision:number;config:PublicAIConfig;secret:EncryptedAISecret|null;enabled:boolean;testState:'never'|'pending'|'passed'|'failed';testedMaterialRevision:number|null;testMode:AIMode|null;testStartedAt:string|null;testedAt:string|null;updatedAt:string};
export interface AISettingsRepository{
 get(owner:string):Promise<AISettingsRow|null>;
 change(owner:string,expectedRevision:number,update:(previous:AISettingsRow|null)=>AISettingsRow):Promise<AISettingsRow>;
}
