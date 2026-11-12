import {open,unlink,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import type {WorkerBinding} from '../worker-host-candidate/owned-process.ts';
import type {WorkerOutcomeJournal,WorkerPending} from '../worker-host-candidate/channel.ts';
import {checkedFile,privateDirectory,sha256,syncDirectory} from './private-files.ts';
const pendingSchema=z.strictObject({operationId:z.enum(['claimRequirementExecution','updateRequirementExecution']),requestId:z.uuid().nullable(),reason:z.enum(['unknown','readback-unverified'])});
const envelope=z.strictObject({bindingSHA256:z.string(),pending:pendingSchema});
/** This small journal is only a write blockade. Original commands and receipts
 * stay in the adopted client's durable store and are never reconstructed here. */
export function createWorkerPendingJournal(directory:string,binding:WorkerBinding):WorkerOutcomeJournal{
 const path=join(directory,'business-pending.json'),bindingSHA256=sha256(JSON.stringify(binding));
 async function read(){await privateDirectory(directory);try{const raw=await checkedFile(path,true,8192),parsed=envelope.safeParse(JSON.parse(raw.toString('utf8')));if(!parsed.success||parsed.data.bindingSHA256!==bindingSHA256)throw Error();return parsed.data.pending;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw Error('WORKER_PENDING_REJECTED');}}
 return{
  read,
  async remember(input:WorkerPending){const pending=pendingSchema.parse(input),previous=await read();if(previous){if(JSON.stringify(previous)!==JSON.stringify(pending))throw Error('WORKER_PENDING_CHANGED');return;}
   const fd=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await fd.writeFile(JSON.stringify({bindingSHA256,pending}));await fd.sync();}finally{await fd.close();}await syncDirectory(directory);
  },
  async clear(){if(await read()===null)return;const before=await lstat(path);if(!before.isFile()||before.nlink!==1)throw Error('WORKER_PENDING_REJECTED');await unlink(path);await syncDirectory(directory);},
 };
}
