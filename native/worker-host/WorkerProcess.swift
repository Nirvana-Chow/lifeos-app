import Foundation
import Darwin
struct HeldParameters{let executable:String,root:String,promptRead:Int32,outputWrite:Int32,gateRead:Int32,gateWrite:Int32}
struct HeldProcess{let pid:Int32}
func spawnHeldProcess(_ p:HeldParameters)throws->HeldProcess{
 var actions:posix_spawn_file_actions_t?,attr:posix_spawnattr_t?
 guard posix_spawn_file_actions_init(&actions)==0 else{try deny("SPAWN_ACTIONS_FAILED")};defer{posix_spawn_file_actions_destroy(&actions)}
 guard posix_spawnattr_init(&attr)==0 else{try deny("SPAWN_ATTRIBUTES_FAILED")};defer{posix_spawnattr_destroy(&attr)}
 guard posix_spawnattr_setpgroup(&attr,0)==0,posix_spawnattr_setflags(&attr,Int16(POSIX_SPAWN_SETPGROUP|POSIX_SPAWN_CLOEXEC_DEFAULT))==0,
 posix_spawn_file_actions_adddup2(&actions,p.gateRead,19)==0,posix_spawn_file_actions_adddup2(&actions,p.promptRead,0)==0,posix_spawn_file_actions_adddup2(&actions,p.outputWrite,1)==0,posix_spawn_file_actions_adddup2(&actions,p.outputWrite,2)==0,posix_spawn_file_actions_addclose(&actions,p.gateWrite)==0 else{try deny("SPAWN_SETUP_FAILED")}
 let strings=nativeStrings([p.executable,"held-child",p.root]),environment=nativeStrings(["PATH=/usr/bin:/bin","LANG=en_US.UTF-8","LC_ALL=en_US.UTF-8"]);defer{for s in strings+environment{free(s)}}
 var pid:pid_t=0;guard posix_spawn(&pid,p.executable,&actions,&attr,strings,environment)==0 else{try deny("SPAWN_FAILED")};return HeldProcess(pid:pid)
}
func runHeldChild(root:String)throws{
 var byte:UInt8=0;let count=Darwin.read(19,&byte,1);close(19);guard count==1,byte==65 else{_exit(78)}
 let raw=try privateRead(root+"/spec.json"),spec=try decodeSpec(raw),ledger=try JSONDecoder().decode(WorkerLedger.self,from:privateRead(root+"/ledger.json"))
 guard ledger.jobId==spec.jobId,ledger.specSHA256==sha(raw),ledger.state=="armed",let worker=ledger.worker,worker.pid==getpid(),let actual=try processSnapshot(getpid()),sameProcess(worker,actual),actual.pgid==getpid(),chdir(spec.workingDirectory)==0 else{try deny("START_HANDSHAKE_REJECTED")}
 let args=nativeStrings(spec.args),environment=nativeStrings(["PATH=/usr/bin:/bin","LANG=en_US.UTF-8","LC_ALL=en_US.UTF-8"]);defer{for s in args+environment{free(s)}}
 execve(spec.code.binary,args,environment);_exit(78)
}
final class HostControl:@unchecked Sendable{private let lock=NSLock();private var stopped=false;func cancel(){lock.lock();stopped=true;lock.unlock()};var cancelled:Bool{lock.lock();defer{lock.unlock()};return stopped}}
// Only the original parent may signal this group. It has not reaped its leader,
// so that PID/pgid cannot be reused. Recovery never calls this helper.
func ownedAnchor(_ pid:Int32,_ start:proc_bsdinfo)->Bool{
 // On this macOS proc_pidinfo returns ESRCH for an exited unreaped child.
 // WNOWAIT proves it is still this parent's waitable child without freeing PID.
 var exited=siginfo_t();if waitid(P_PID,id_t(pid),&exited,WEXITED|WNOHANG|WNOWAIT)==0&&exited.si_pid==pid{return true}
 guard let now=rawBSD(pid) else{return false};return now.pbi_ppid==UInt32(getpid())&&now.pbi_pgid==UInt32(pid)&&now.pbi_start_tvsec==start.pbi_start_tvsec&&now.pbi_start_tvusec==start.pbi_start_tvusec
}
func stopOwnedGroup(_ pid:Int32,_ start:proc_bsdinfo)->Bool{
 guard ownedAnchor(pid,start) else{return false};_ = kill(-pid,SIGTERM)
 for index in 0..<150{
  guard ownedAnchor(pid,start),let members=liveGroup(pid) else{return false};if members.isEmpty{return true}
  if index==30{_ = kill(-pid,SIGKILL)};usleep(10000)
 };return false
}
func runWorkerHost(spec:WorkerSpec,root:String,spawn:(HeldParameters)throws->HeldProcess=spawnHeldProcess)throws{
 let parent=URL(fileURLWithPath:root).deletingLastPathComponent().path
 guard try physicalPath(parent)+"/"+spec.jobId==root,URL(fileURLWithPath:root).lastPathComponent==spec.jobId else{try deny("ROOT_REJECTED")}
 if mkdir(root,0o700) != 0{try deny("JOB_ALREADY_EXISTS")}
 var st=stat();guard lstat(root,&st)==0,st.st_mode&S_IFMT==S_IFDIR,st.st_uid==getuid(),st.st_mode&0o077==0 else{try deny("ROOT_REJECTED")}
 var payload=try objectData(spec);if spec.channelPeer==nil{payload["channelPeer"]=NSNull()}
 let raw=try jsonData(payload);try privateAtomic(root+"/spec.json",raw)
 guard let host=try processSnapshot(getpid()) else{try deny("HOST_IDENTITY_UNAVAILABLE")}
 var ledger=WorkerLedger(version:1,specSHA256:sha(raw),jobId:spec.jobId,host:host,state:"prepared",worker:nil,groupEmpty:false,escaped:[]);try writeLedger(root,ledger)
 var gate=[Int32](repeating:0,count:2),prompt=[Int32](repeating:0,count:2),output=[Int32](repeating:0,count:2);guard pipe(&gate)==0,pipe(&prompt)==0,pipe(&output)==0 else{try deny("PIPE_FAILED")}
 defer{for fd in gate+prompt+output{close(fd)}}
 let executable=try physicalPath(CommandLine.arguments[0])
 let child=try spawn(HeldParameters(executable:executable,root:root,promptRead:prompt[0],outputWrite:output[1],gateRead:gate[0],gateWrite:gate[1]))
 let anchor=rawBSD(child.pid);var completed=false
 defer{
  if !completed{
   // Closing the anonymous gate first also covers every pre-release throw.
   if gate[1]>=0{close(gate[1]);gate[1] = -1}
   ledger.groupEmpty=anchor.map{stopOwnedGroup(child.pid,$0)} ?? false
   if ledger.groupEmpty{var status:Int32=0;_ = waitpid(child.pid,&status,0)}
   ledger.state="quarantined";ledger.outcome="unknown";ledger.reusable=false;try? writeLedger(root,ledger)
  }
 }
 guard let anchor,ownedAnchor(child.pid,anchor) else{try deny("CHILD_OWNERSHIP_UNAVAILABLE")}
 close(gate[0]);gate[0] = -1;close(prompt[0]);prompt[0] = -1;close(output[1]);output[1] = -1
 guard let identity=try processSnapshot(child.pid),identity.pgid==child.pid,identity.ppid==getpid() else{try deny("CHILD_IDENTITY_UNAVAILABLE")}
 ledger.worker=identity;ledger.state="armed";try writeLedger(root,ledger)
 let text=Data("Execute assigned LifeOS job \(spec.jobId). Use only the assigned worker tools. Business completion requires receipt and independent readback.\n".utf8);try text.withUnsafeBytes{b in guard Darwin.write(prompt[1],b.baseAddress,b.count)==b.count else{try deny("PROMPT_FAILED")}};close(prompt[1]);prompt[1] = -1
 var release:UInt8=65;guard Darwin.write(gate[1],&release,1)==1 else{try deny("START_RELEASE_FAILED")};close(gate[1]);gate[1] = -1
 let control=HostControl();DispatchQueue.global().async{while true{do{let line=try readInputLine();if line.isEmpty{control.cancel();return};guard let value=try JSONSerialization.jsonObject(with:line) as? [String:String],value==["command":"cancel"] else{control.cancel();return};control.cancel()}catch{control.cancel();return}}}
 _=fcntl(output[0],F_SETFL,O_NONBLOCK);let targetArguments=sha(try jsonData(spec.args)),started=Date(),deadline=Date().addingTimeInterval(Double(spec.maxWallMs)/1000);var term:Date?,killed=false,bytes=0,reported=false
 while true{
  var data=[UInt8](repeating:0,count:4096);let n=Darwin.read(output[0],&data,data.count);if n>0{bytes+=n;if bytes>spec.maxOutputBytes{control.cancel()}}
  guard let escaped=escapedChildren(child.pid) else{try deny("CHILD_OBSERVATION_UNAVAILABLE")};if !escaped.isEmpty{ledger.escaped=escaped;control.cancel()}
  if !reported,let actual=try processSnapshot(child.pid),actual.running,actual.executable==spec.code.binary,actual.codeSHA256==spec.code.sha256,actual.argsSHA256==targetArguments{ledger.worker=actual;ledger.state="running";try writeLedger(root,ledger);if !emitMetadata(["event":"started","jobId":spec.jobId,"worker":try objectData(actual)]){control.cancel()};reported=true}
  let state=rawBSD(child.pid);if state==nil||state?.pbi_status==5||Date()>=deadline{control.cancel()}
  guard ownedAnchor(child.pid,anchor) else{try deny("CHILD_OWNERSHIP_LOST")}
  if control.cancelled&&term==nil{ledger.state="stopping";try writeLedger(root,ledger);term=Date();_ = kill(-child.pid,SIGTERM)}
  if let stop=term,Date().timeIntervalSince(stop)>0.3 && !killed{_ = kill(-child.pid,SIGKILL);killed=true}
  guard let members=liveGroup(child.pid) else{try deny("GROUP_OBSERVATION_UNAVAILABLE")}
  if control.cancelled&&members.isEmpty{ledger.groupEmpty=true;break}
  if let stop=term,Date().timeIntervalSince(stop)>1.5{ledger.state="quarantined";break}
  usleep(10000)
 }
 // Do not reap the leader before group cancellation: its retained child identity
 // prevents its PID/pgid from being reused as a different process-group target.
 if ledger.groupEmpty{var status:Int32=0;_ = waitpid(child.pid,&status,0)}
 ledger.state=ledger.groupEmpty&&ledger.escaped.isEmpty ? "exited":"quarantined";ledger.outcome="unknown";ledger.reusable=false;try writeLedger(root,ledger)
 completed=true
 emitMetadata(["event":"process-completed","jobId":spec.jobId,"state":ledger.state,"groupEmpty":ledger.groupEmpty,"outcome":"unknown","reusable":false,"elapsedMs":Int(Date().timeIntervalSince(started)*1000)])
}
