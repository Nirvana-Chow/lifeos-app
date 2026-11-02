import type {Readable,Writable} from 'node:stream';
/** One private transport session: the caller owns authenticating and closing the streams. */
export function ownerOperatorDelivery(input:Readable,output:Writable){
 let used=false;
 return{kind:'trusted-operator' as const,send:async({code,signal}:{code:string;expiresInSeconds:number;signal:AbortSignal}):Promise<void>=>{
  if(used||signal.aborted||!/^[A-Za-z0-9_-]{20,256}$/.test(code))throw Error('RECOVERY_TRANSPORT_UNAVAILABLE');used=true;
  await new Promise<void>((resolve,reject)=>{
   let size=0,frame='',ended=false,written=false,settled=false;
   const clean=()=>{input.off('data',onData);input.off('end',onEnd);input.off('close',onClose);input.off('error',fail);output.off('error',fail);output.off('close',onOutputClose);signal.removeEventListener('abort',fail);};
   const stop=(ok:boolean)=>{if(settled)return;settled=true;clean();ok?resolve():reject(Error('RECOVERY_TRANSPORT_UNCONFIRMED'));};
   const fail=()=>stop(false);
   const onData=(chunk:Buffer|string)=>{if(!written){fail();return;}const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;if(size>4){fail();return;}frame+=bytes.toString('utf8');};
   const onEnd=()=>{ended=true;if(frame!=='ACK\n'){fail();return;}if(written)stop(true);};
   const onClose=()=>{if(!ended)fail();};const onOutputClose=()=>fail();
   input.on('data',onData);input.once('end',onEnd);input.once('close',onClose);input.once('error',fail);output.once('error',fail);output.once('close',onOutputClose);signal.addEventListener('abort',fail,{once:true});
   if(signal.aborted){fail();return;}
   try{output.write(code+'\n',error=>{if(error){fail();return;}written=true;if(ended)stop(true);});}catch{fail();}
  });
 }};
}
