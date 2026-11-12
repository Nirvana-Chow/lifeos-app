import Foundation
import Darwin
@main enum WorkerHostMain{
 static func main(){
  do{
   try configureHostProcess()
   var core=rlimit(rlim_cur:0,rlim_max:0);guard setrlimit(RLIMIT_CORE,&core)==0 else{try deny("CORE_LIMIT_FAILED")}
   let args=CommandLine.arguments;guard args.count==3 else{try deny("COMMAND_REJECTED")}
   if args[1]=="held-child"{try runHeldChild(root:args[2]);return}
   if args[1]=="inspect"{emitMetadata(try inspectWorker(args[2]));return}
   if args[1]=="attest"{emitMetadata(try attestWorkerPeer(args[2]));return}
   guard args[1]=="run" else{try deny("COMMAND_REJECTED")}
   let spec=try decodeSpec(readInputLine());try runWorkerHost(spec:spec,root:args[2])
  }catch{if case HostError.denied(let code)=error{emitMetadata(["error":"WORKER_HOST_REJECTED","stage":code])}else{emitMetadata(["error":"WORKER_HOST_REJECTED"])};exit(78)}
 }
}
