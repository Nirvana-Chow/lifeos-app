import Foundation
import Darwin
@main enum FaultFixture {
 static func main(){
  do{
   try configureHostProcess()
   let args=CommandLine.arguments
   if args.count==3&&args[1]=="probe" {let value=try processSnapshot(Int32(args[2])!);emitMetadata(value.map{try! objectData($0)} ?? ["running":false]);return}
   if args.count>=3&&args[1]=="held-child" {try runHeldChild(root:args[2]);return}
   guard args.count==3&&args[1]=="run" else{exit(78)}
   let root=args[2],spec=try decodeSpec(readInputLine())
   try runWorkerHost(spec:spec,root:root,spawn:{parameters in
    let result=try spawnHeldProcess(parameters)
    try privateAtomic(root+"/fault-observed.json",try jsonData(["pid":result.pid]))
    _exit(91)
   })
  }catch{if case HostError.denied(let code)=error{emitMetadata(["error":"FIXTURE_REJECTED","stage":code])}else{emitMetadata(["error":"FIXTURE_REJECTED"])};exit(78)}
 }
}
