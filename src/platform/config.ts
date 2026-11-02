export type PlatformConfig={baseURL:string;ownerId:string;ownerEmail:string;secret:string;databaseURL:string;sessionSeconds:number};
export function isHTTPSOrigin(base:URL):boolean{return base.protocol==='https:'&&!base.port&&!base.username&&!base.password&&base.hostname.length<=253&&/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(base.hostname)&&base.origin===base.href.replace(/\/$/,'');}
export function readPlatformConfig(env:Record<string,string|undefined>):PlatformConfig|null{
 if(env.LIFEOS_PLATFORM_CANDIDATE!=='1')return null;
 const fail=():never=>{throw Error('Isolated platform configuration unavailable');};
 const baseURL=env.LIFEOS_PLATFORM_BASE_URL,ownerId=env.LIFEOS_PLATFORM_OWNER_ID?.trim(),ownerEmail=env.LIFEOS_PLATFORM_OWNER_EMAIL?.trim().toLowerCase(),secret=env.LIFEOS_PLATFORM_SECRET,databaseURL=env.LIFEOS_PLATFORM_TEST_DATABASE_URL;
 if(env.LIFEOS_PLATFORM_TARGET!=='isolated-test'||!baseURL||!ownerId||!/^[A-Za-z0-9_-]{6,80}$/.test(ownerId)||!ownerEmail||ownerEmail.length>254||!/^\S+@\S+\.\S+$/.test(ownerEmail)||!secret||Buffer.byteLength(secret)<32||!databaseURL)return fail();
 try{
  const base=new URL(baseURL),db=new URL(databaseURL);
  if(base.origin!==baseURL)return fail();
  if(env.LIFEOS_PLATFORM_TRANSPORT==='https-origin'){if(!isHTTPSOrigin(base)||env.LIFEOS_PLATFORM_HTTPS_HOST!==base.hostname)return fail();}
  else if(env.LIFEOS_PLATFORM_TRANSPORT&&env.LIFEOS_PLATFORM_TRANSPORT!=='loopback'||env.LIFEOS_PLATFORM_HTTPS_HOST||base.hostname!=='127.0.0.1'||base.protocol!=='http:'||!base.port||Number(base.port)<1024)return fail();
  if(!['postgres:','postgresql:'].includes(db.protocol)||db.hostname!=='127.0.0.1'||db.username!=='lifeos_platform_candidate_runtime'||!db.password||!/^\/lifeos_platform_test_[a-z0-9_]+$/.test(db.pathname)||db.search||db.hash)return fail();
 }catch{return fail();}
 return{baseURL,ownerId,ownerEmail,secret,databaseURL,sessionSeconds:1800};
}
