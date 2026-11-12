import {constants} from 'node:fs';
import {open,realpath,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {z} from 'zod';

export const digestSchema=z.string().regex(/^[a-f0-9]{64}$/);
export const absolutePathSchema=z.string().min(1).max(4096).refine(isAbsolute);
export const codePinSchema=z.strictObject({binary:absolutePathSchema,sha256:digestSchema});
export type CodePin=z.infer<typeof codePinSchema>;
export const sha256=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export async function privateDirectory(path:string){
 const st=await lstat(path);if(!st.isDirectory()||st.uid!==process.getuid!()||st.mode&0o077||await realpath(path)!==path)throw Error('WORKER_PRIVATE_PATH_REJECTED');
}
export async function checkedFile(path:string,privateFile=false,limit=8*1024*1024):Promise<Buffer>{
 if(!isAbsolute(path)||await realpath(path)!==path)throw Error('WORKER_CODE_REJECTED');
 const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const st=await handle.stat();if(!st.isFile()||st.uid!==process.getuid!()||st.nlink!==1||st.mode&(privateFile?0o077:0o6022)||st.size>limit)throw Error('WORKER_CODE_REJECTED');return await handle.readFile();}finally{await handle.close();}
}
export async function checkedPin(pin:CodePin,privateFile=false):Promise<Buffer>{
 codePinSchema.parse(pin);const bytes=await checkedFile(pin.binary,privateFile,512*1024*1024);if(!bytes.length||sha256(bytes)!==pin.sha256)throw Error('WORKER_CODE_REJECTED');return bytes;
}
export async function syncDirectory(path:string){const h=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await h.sync();}finally{await h.close();}}
