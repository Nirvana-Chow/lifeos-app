// Synthetic stdio qualification only. No credentials, HTTP or real CLI.
import {createWorkerChannel} from '../../src/worker-host-candidate/channel.ts';
import {serveAssignedWorkerStdio} from '../../src/worker-host-candidate/mcp.ts';
import {requirements} from '../../src/platform/requirements.ts';
const assignment={jobId:'11111111-1111-4111-8111-111111111111',requirementId:'LO-REQ-001',sourceId:'22222222-2222-4222-8222-222222222222',workDigest:'a'.repeat(64),holderId:'synthetic-stdio',claimKey:'synthetic-stdio-claim',fence:1};
const fields={title:'Synthetic assigned record',body:'Synthetic only',phaseId:requirements().roadmap!.phases[0].id,priority:'P2',plannedStartOn:null,plannedEndOn:null,workflow:{state:'planned',purpose:'Qualification',nextStep:'Verify'}};
const channel=createWorkerChannel({assignment,attest:async()=>{},journal:{read:async()=>null,remember:async()=>{},clear:async()=>{}},client:{
 execute:async operationId=>{if(operationId!=='getRequirement')throw Error('fixture_private_error');return{ok:true,status:200,data:{entry:{id:assignment.requirementId,sourceId:assignment.sourceId,revision:1,fields},execution:{requirementId:assignment.requirementId,sourceId:assignment.sourceId,workDigest:assignment.workDigest,revision:1}}};},
 retry:async()=>{throw Error('fixture_private_error');},
}});
await serveAssignedWorkerStdio(channel);
