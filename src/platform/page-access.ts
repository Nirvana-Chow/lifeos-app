import type {Principal} from './contracts.ts';
/** The reader must verify configured owner ID and email on the server. */
export async function pageAccess(path:string,read:()=>Promise<Principal|null>):Promise<string|null>{
 if(['/review/admin/login','/candidate/login'].includes(path))return '/login';
 try{return await read()?null:'/login';}catch{return '/login';}
}
export type LoginCapability={mode:'closed'|'personal'|'synthetic';enabled:boolean;ownerAlias?:'owner'};
export function loginCapability(config:{baseURL:string;ownerId:string;ownerEmail:string}|null,personal:boolean,writable:boolean,sshLoopbackApproved=false):LoginCapability{
 if(!config)return{mode:'closed',enabled:false};
 if(personal){const url=new URL(config.baseURL),secure=url.protocol==='https:'||sshLoopbackApproved&&url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!!url.port&&Number(url.port)>=1024;return{mode:'personal',enabled:writable&&secure};}
 if(config.ownerId==='fixture-owner-a'&&config.ownerEmail==='fixture@example.invalid')return{mode:'synthetic',enabled:true};
 return{mode:'closed',enabled:false};
}
