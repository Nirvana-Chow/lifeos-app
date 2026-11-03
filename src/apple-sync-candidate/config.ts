/** Source capability only: this flag does not provision identity or grant writes. */
export function readAppleSyncConfig(env:Record<string,string|undefined>):Readonly<{enabled:boolean}>{
 const value=env.LIFEOS_APPLE_SYNC_CANDIDATE;
 if(value!==undefined&&value!=='0'&&value!=='source-v1')throw Error('Apple sync candidate configuration unavailable');
 return Object.freeze({enabled:value==='source-v1'});
}
