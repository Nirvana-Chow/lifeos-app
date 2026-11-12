import {bridgeBindingSchema} from './contracts.ts';
import {checkedPin,privateDirectory} from './private-files.ts';
import {createPinnedWorkerClient} from './business-client.ts';
import {createWorkerPendingJournal} from './pending-journal.ts';
import {attestOwnedWorker,type WorkerBinding} from '../worker-host-candidate/owned-process.ts';
import {createWorkerChannel} from '../worker-host-candidate/channel.ts';
import {serveAssignedWorkerStdio} from '../worker-host-candidate/mcp.ts';

/** Invoked only by the pinned bootstrap after its actual code gate. The private
 * root-produced binding is not a tool argument or model-selected runtime. */
export async function serveAdoptedWorkerBridge(input:unknown){
 const binding=bridgeBindingSchema.parse(input),a=binding.assignment;
 const identity:WorkerBinding={jobId:a.jobId,requirementId:a.requirementId,sourceId:a.sourceId,workDigest:a.workDigest,fence:a.fence};
 await privateDirectory(binding.jobDirectory);await checkedPin(binding.clientEntry);
 const attest=()=>attestOwnedWorker(identity,binding.host,binding.jobDirectory);
 await attest();
 return serveAssignedWorkerStdio(createWorkerChannel({assignment:a,attest,
  client:createPinnedWorkerClient({entry:binding.clientEntry}),
  journal:createWorkerPendingJournal(binding.jobDirectory,identity),
 }));
}
