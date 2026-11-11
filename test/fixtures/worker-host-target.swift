import Foundation
import Darwin
@main enum TargetFixture {
 static func main() throws {
  let args=CommandLine.arguments;let mode=args[1],root=args[2]
  if mode == "escaped-child" { _=setsid();try Data("{\"pid\":\(getpid())}".utf8).write(to:URL(fileURLWithPath:root+"/escaped-child.json"));while true{sleep(1)} }
  try Data("synthetic-only".utf8).write(to:URL(fileURLWithPath:root+"/target-started"))
  var child:pid_t=0;let command=mode == "escape" ? [args[0],"escaped-child",root] : ["/bin/sleep","60"]
  let values=command.map{strdup($0)}+[nil];defer{for p in values{free(p)}}
  guard posix_spawn(&child,command[0],nil,nil,values,environ)==0 else{exit(1)}
  try Data("{\"pid\":\(child)}".utf8).write(to:URL(fileURLWithPath:root+"/target-child.json"))
  if mode == "attest" {
   for _ in 0..<200{if let raw=try? Data(contentsOf:URL(fileURLWithPath:root+"/ledger.json")),let value=try? JSONSerialization.jsonObject(with:raw) as? [String:Any],value["state"] as? String == "running"{break};usleep(10000)}
   var actions:posix_spawn_file_actions_t?;posix_spawn_file_actions_init(&actions);defer{posix_spawn_file_actions_destroy(&actions)}
   let temporary=root+"/peer-attestation.partial",path=root+"/peer-attestation.json";posix_spawn_file_actions_addopen(&actions,1,temporary,O_WRONLY|O_CREAT|O_EXCL,0o600)
   let command=[args[3],"attest",root].map{strdup($0)}+[nil];defer{for p in command{free(p)}};var reader:pid_t=0
   guard posix_spawn(&reader,args[3],&actions,nil,command,environ)==0 else{exit(1)};var status:Int32=0;waitpid(reader,&status,0);guard status==0,rename(temporary,path)==0 else{exit(1)}
  }
  if mode == "early" {exit(0)}
  if mode == "flood" {let data=[UInt8](repeating:65,count:16384);while true{_=data.withUnsafeBytes{Darwin.write(1,$0.baseAddress,$0.count)}}}
  FileHandle.standardOutput.write(Data("fixture_private_stdout".utf8));while true{sleep(1)}
 }
}
