export class DurableStore {
 constructor(directory:string,fingerprint:string);
 readonly binding:Readonly<{origin:string;apiBase:string;credentialFingerprint:string}>;
 exclusive<T>(fn:()=>Promise<T>):Promise<T>;
 prepare(request:any):void;receipt(id:string,receipt:any):void;unknown(id:string):void;rejected(id:string,result:any):void;finish(id:string,result:any):void;
 pending(id:string):any;settled(id:string):any;findRequestByKey(key:string):any;manifest(preview:any):void;getManifest(planId:string,digest:string):any;
}

export function inspectWriterLock(directory:string):{pid:number;ownerAlive:boolean;digest:string};
export function recoverWriterLock(directory:string,expectedDigest:string):{recovered:boolean;quarantine:string;ownerPID:number;digest:string};
