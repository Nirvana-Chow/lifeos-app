import Foundation
import Darwin

/** Same-UID cooperative binding, not an OS sandbox or credential isolation.
 * The separately adopted client still verifies its complete dependency pins.
 * Only this attestor's actual parent is considered; callers cannot submit PID. */
func attestWorkerPeer(_ root:String)throws->[String:Any]{
 let raw=try privateRead(root+"/spec.json"),spec=try decodeSpec(raw),ledger=try JSONDecoder().decode(WorkerLedger.self,from:privateRead(root+"/ledger.json"))
 guard ledger.version==1,ledger.jobId==spec.jobId,ledger.specSHA256==sha(raw),ledger.state=="running",let expected=spec.channelPeer,
 let recorded=ledger.worker,let worker=try processSnapshot(recorded.pid),worker.running,sameProcess(recorded,worker),worker.executable==spec.code.binary,worker.codeSHA256==spec.code.sha256,worker.argsSHA256==sha(try jsonData(spec.args)),
 let host=try processSnapshot(ledger.host.pid),host.running,sameProcess(ledger.host,host),host.codeSHA256==ledger.host.codeSHA256,host.argsSHA256==ledger.host.argsSHA256 else{try deny("JOB_NOT_RUNNING")}
 guard let peer=try processSnapshot(getppid()),peer.running,peer.pgid==worker.pgid,peer.executable==expected.code.binary,peer.codeSHA256==expected.code.sha256,peer.argsSHA256==sha(try jsonData(expected.args)),try regularCodeHash(expected.entry.binary)==expected.entry.sha256 else{try deny("PEER_REJECTED")}
 var pid=peer.pid,seen=Set<Int32>(),related=false
 for _ in 0..<32{
  guard seen.insert(pid).inserted,let current=rawBSD(pid),current.pbi_uid==getuid(),current.pbi_pgid==UInt32(worker.pgid) else{break}
  if pid==worker.pid{related=current.pbi_start_tvsec==worker.startSeconds&&current.pbi_start_tvusec==worker.startMicros;break}
  pid=Int32(current.pbi_ppid)
 }
 guard related else{try deny("PEER_REJECTED")}
 return["attested":true,"jobId":spec.jobId,"requirementId":spec.requirementId,"sourceId":spec.sourceId,"workDigest":spec.workDigest,"fence":spec.fence]
}
