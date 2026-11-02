import type{AISettingsRepository,AISettingsRow}from'../../src/platform/ai-settings-repository.ts';
import{PlatformError}from'../../src/platform/domain.ts';
export class MemoryAISettings implements AISettingsRepository{
 readonly rows=new Map<string,AISettingsRow>();private tails=new Map<string,Promise<void>>();
 async get(owner:string){return structuredClone(this.rows.get(owner)??null);}
 async change(owner:string,expected:number,update:(row:AISettingsRow|null)=>AISettingsRow){
  const prior=this.tails.get(owner)??Promise.resolve();let release!:()=>void;const next=new Promise<void>(r=>release=r);this.tails.set(owner,next);await prior;
  try{const old=this.rows.get(owner)??null;if((old?.revision??0)!==expected)throw new PlatformError(409,'AI_SETTINGS_CONFLICT','配置已更新，请重新读取。');const value=update(structuredClone(old));if(value.ownerId!==owner||value.revision!==expected+1)throw Error('Invalid test write');this.rows.set(owner,structuredClone(value));return structuredClone(value);}finally{release();if(this.tails.get(owner)===next)this.tails.delete(owner);}
 }
}
