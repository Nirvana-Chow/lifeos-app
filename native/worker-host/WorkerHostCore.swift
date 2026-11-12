import Foundation
import CryptoKit
import Darwin

enum HostError:Error{case denied(String)}
func deny(_ code:String)throws->Never{throw HostError.denied(code)}
func sha(_ data:Data)->String{SHA256.hash(data:data).map{String(format:"%02x",$0)}.joined()}
func nativeStrings(_ values:[String])->[UnsafeMutablePointer<CChar>?]{values.map{value in value.withCString{strdup($0)}}+[nil]}
func physicalPath(_ path:String)throws->String{guard let pointer=realpath(path,nil) else{try deny("PATH_UNAVAILABLE")};defer{free(pointer)};return String(cString:pointer)}
func jsonData(_ value:Any)throws->Data{try JSONSerialization.data(withJSONObject:value,options:[.sortedKeys])}
func objectData<T:Encodable>(_ value:T)throws->[String:Any]{try JSONSerialization.jsonObject(with:JSONEncoder().encode(value)) as! [String:Any]}
func configureHostProcess()throws{
 var ignored=sigaction(),defaults=sigaction();ignored.__sigaction_u.__sa_handler=SIG_IGN;defaults.__sigaction_u.__sa_handler=SIG_DFL
 guard sigemptyset(&ignored.sa_mask)==0,sigemptyset(&defaults.sa_mask)==0,sigaction(SIGPIPE,&ignored,nil)==0,sigaction(SIGCHLD,&defaults,nil)==0 else{try deny("SIGNAL_SETUP_FAILED")}
}
@discardableResult func emitMetadata(_ value:[String:Any])->Bool{
 guard var raw=try? jsonData(value) else{return false};raw.append(10)
 return raw.withUnsafeBytes{buffer in var offset=0;while offset<buffer.count{let n=Darwin.write(STDOUT_FILENO,buffer.baseAddress!.advanced(by:offset),buffer.count-offset);if n<0&&errno==EINTR{continue};if n<=0{return false};offset+=n};return true}
}
struct WorkerCode:Codable{let binary:String,sha256:String}
struct WorkerPeer:Codable{let code:WorkerCode,entry:WorkerCode,args:[String]}
struct WorkerSpec:Codable{
 let schemaVersion:Int,jobId:String,requirementId:String,sourceId:String,workDigest:String,fence:Int64
 let code:WorkerCode,args:[String],channelPeer:WorkerPeer?,workingDirectory:String,reservedSlots:Int,maxWallMs:Int,maxOutputBytes:Int
}
struct ProcessIdentity:Codable{
 let pid:Int32,ppid:Int32,pgid:Int32,startSeconds:UInt64,startMicros:UInt64,executable:String,codeSHA256:String,argsSHA256:String,running:Bool
}
struct WorkerLedger:Codable{
 let version:Int,specSHA256:String,jobId:String,host:ProcessIdentity
 var state:String,worker:ProcessIdentity?,groupEmpty:Bool,escaped:[ProcessIdentity],outcome:String="unknown",reusable:Bool=false
}
func rawBSD(_ pid:Int32)->proc_bsdinfo?{var value=proc_bsdinfo();return proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&value,Int32(MemoryLayout<proc_bsdinfo>.size))==MemoryLayout<proc_bsdinfo>.size ? value:nil}
func privateRead(_ path:String,limit:Int=131072)throws->Data{
 let fd=open(path,O_RDONLY|O_NOFOLLOW);guard fd>=0 else{try deny("FILE_UNAVAILABLE")};defer{close(fd)}
 var s=stat();guard fstat(fd,&s)==0,s.st_mode&S_IFMT==S_IFREG,s.st_uid==getuid(),s.st_nlink==1,s.st_mode&0o077==0,s.st_size<=limit else{try deny("UNSAFE_PRIVATE_FILE")}
 return try FileHandle(fileDescriptor:fd,closeOnDealloc:false).readToEnd() ?? Data()
}
func privateAtomic(_ path:String,_ data:Data)throws{
 let temporary=path+"."+UUID().uuidString,fd=open(temporary,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0o600);guard fd>=0 else{try deny("STATE_CREATE_FAILED")}
 var saved=false;defer{close(fd);if !saved{unlink(temporary)}}
 try data.withUnsafeBytes{buffer in var offset=0;while offset<buffer.count{let n=Darwin.write(fd,buffer.baseAddress!.advanced(by:offset),buffer.count-offset);if n<0&&errno==EINTR{continue};guard n>0 else{try deny("STATE_WRITE_FAILED")};offset+=n}}
 guard fsync(fd)==0,rename(temporary,path)==0 else{try deny("STATE_SYNC_FAILED")};saved=true
 let dir=open(URL(fileURLWithPath:path).deletingLastPathComponent().path,O_RDONLY|O_DIRECTORY);guard dir>=0 else{try deny("STATE_DIRECTORY_FAILED")};defer{close(dir)};guard fsync(dir)==0 else{try deny("STATE_DIRECTORY_FAILED")}
}
func regularCodeHash(_ path:String)throws->String{
 guard path.hasPrefix("/"),try physicalPath(path)==path else{try deny("CODE_PATH_REJECTED")}
 let fd=open(path,O_RDONLY|O_NOFOLLOW);guard fd>=0 else{try deny("CODE_UNAVAILABLE")};defer{close(fd)}
 var s=stat();guard fstat(fd,&s)==0,s.st_mode&S_IFMT==S_IFREG,s.st_nlink==1,s.st_mode&0o6022==0,s.st_size>0,s.st_size<=512*1024*1024 else{try deny("CODE_FILE_REJECTED")}
 return sha(try FileHandle(fileDescriptor:fd,closeOnDealloc:false).readToEnd() ?? Data())
}
func processArguments(_ pid:Int32)throws->[String]{
 var query:[Int32]=[CTL_KERN,KERN_PROCARGS2,pid],buffer=[UInt8](repeating:0,count:256*1024),size=buffer.count
 guard sysctl(&query,3,&buffer,&size,nil,0)==0,size>4 else{try deny("PROCESS_ARGUMENTS_UNAVAILABLE")}
 let count=buffer.withUnsafeBytes{$0.loadUnaligned(as:Int32.self)};guard count>0,count<=256 else{try deny("PROCESS_ARGUMENTS_REJECTED")}
 var at=4;while at<size&&buffer[at] != 0{at+=1};while at<size&&buffer[at]==0{at+=1};var args:[String]=[]
 for _ in 0..<count{let start=at;while at<size&&buffer[at] != 0{at+=1};guard at<size,let text=String(bytes:buffer[start..<at],encoding:.utf8) else{try deny("PROCESS_ARGUMENTS_REJECTED")};args.append(text);at+=1}
 return args // Never parse or emit the environment following argc arguments.
}
func processSnapshot(_ pid:Int32)throws->ProcessIdentity?{
 guard let b=rawBSD(pid),b.pbi_uid==getuid() else{return nil}
 guard b.pbi_status != 5 else{return ProcessIdentity(pid:pid,ppid:Int32(b.pbi_ppid),pgid:Int32(b.pbi_pgid),startSeconds:b.pbi_start_tvsec,startMicros:b.pbi_start_tvusec,executable:"",codeSHA256:"",argsSHA256:"",running:false)}
 // SDK PROC_PIDPATHINFO_MAXSIZE is 4*MAXPATHLEN; Swift cannot import that macro.
 do{
  var bytes=[CChar](repeating:0,count:4*Int(MAXPATHLEN));guard proc_pidpath(pid,&bytes,UInt32(bytes.count))>0 else{try deny("PROCESS_PATH_UNAVAILABLE")}
  let path=try physicalPath(String(cString:bytes)),args=try processArguments(pid),hash=try regularCodeHash(path)
  guard let after=rawBSD(pid),after.pbi_start_tvsec==b.pbi_start_tvsec,after.pbi_start_tvusec==b.pbi_start_tvusec,after.pbi_pgid==b.pbi_pgid,after.pbi_status != 5 else{return nil}
  return ProcessIdentity(pid:pid,ppid:Int32(b.pbi_ppid),pgid:Int32(b.pbi_pgid),startSeconds:b.pbi_start_tvsec,startMicros:b.pbi_start_tvusec,executable:path,codeSHA256:hash,argsSHA256:sha(try jsonData(args)),running:true)
 }catch{if let after=rawBSD(pid),after.pbi_status != 5,after.pbi_start_tvsec==b.pbi_start_tvsec,after.pbi_start_tvusec==b.pbi_start_tvusec{throw error};return nil}
}
func sameProcess(_ expected:ProcessIdentity,_ actual:ProcessIdentity)->Bool{expected.pid==actual.pid&&expected.startSeconds==actual.startSeconds&&expected.startMicros==actual.startMicros&&expected.pgid==actual.pgid}
func groupPIDs(_ pgid:Int32)->[Int32]?{var ids=[Int32](repeating:0,count:4096);errno=0;let bytes=proc_listpids(UInt32(PROC_PGRP_ONLY),UInt32(pgid),&ids,Int32(ids.count*4));if bytes==0&&(errno==0||errno==ESRCH){return[]};guard bytes>0,bytes<Int32(ids.count*4),bytes%4==0 else{return nil};return Array(ids.prefix(Int(bytes)/4)).filter{$0>0}}
func liveGroup(_ pgid:Int32)->[Int32]?{
 guard let pids=groupPIDs(pgid) else{return nil};var live:[Int32]=[]
 for pid in pids{errno=0;if let info=rawBSD(pid){if info.pbi_status != 5{live.append(pid)}}else if errno != ESRCH{return nil}}
 return live // A foreign UID is not evidence of an empty/cleaned group.
}
func escapedChildren(_ leader:Int32)->[ProcessIdentity]?{
 // Query this owned leader's direct children; never inventory unrelated jobs.
 var ids=[Int32](repeating:0,count:4096);errno=0;let count=proc_listchildpids(leader,&ids,Int32(ids.count*4));if count==0&&(errno==0||errno==ESRCH){return[]};guard count>0,count<ids.count else{return nil}
 let children=ids.prefix(Int(count)).compactMap{pid->(Int32,proc_bsdinfo)? in guard pid>0,let b=rawBSD(pid),b.pbi_uid==getuid(),b.pbi_ppid==UInt32(leader),b.pbi_pgid != UInt32(leader),b.pbi_status != 5 else{return nil};return(pid,b)}
 return children.compactMap{try? processSnapshot($0.0)}
}
func decodeSpec(_ data:Data)throws->WorkerSpec{
 guard data.count<=65536,let object=try JSONSerialization.jsonObject(with:data) as? [String:Any],Set(object.keys)==Set(["schemaVersion","jobId","requirementId","sourceId","workDigest","fence","code","args","channelPeer","workingDirectory","reservedSlots","maxWallMs","maxOutputBytes"]),let code=object["code"] as? [String:Any],Set(code.keys)==Set(["binary","sha256"]) else{try deny("SPEC_REJECTED")}
 if let peer=object["channelPeer"] as? [String:Any]{guard Set(peer.keys)==Set(["code","entry","args"]),let code=peer["code"] as? [String:Any],let entry=peer["entry"] as? [String:Any],Set(code.keys)==Set(["binary","sha256"]),Set(entry.keys)==Set(["binary","sha256"]) else{try deny("SPEC_REJECTED")}}
 let s=try JSONDecoder().decode(WorkerSpec.self,from:data)
 guard s.schemaVersion==1,UUID(uuidString:s.jobId) != nil,UUID(uuidString:s.sourceId) != nil,UUID(uuidString:s.requirementId) != nil||s.requirementId.range(of:"^LO-[A-Z]+-[0-9]{3}$",options:.regularExpression) != nil,s.workDigest.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil,s.fence>0,s.fence<=9007199254740991,s.reservedSlots==1,(100...1800000).contains(s.maxWallMs),(1024...1048576).contains(s.maxOutputBytes),s.args.count>0,s.args.count<=128,s.args[0]==s.code.binary,s.args.allSatisfy({$0.utf8.count<=4096 && !$0.contains("\0")}),s.workingDirectory.hasPrefix("/"),try physicalPath(s.workingDirectory)==s.workingDirectory,try regularCodeHash(s.code.binary)==s.code.sha256 else{try deny("SPEC_REJECTED")}
 if let peer=s.channelPeer{guard !peer.args.isEmpty,peer.args.count<=128,peer.args[0]==peer.code.binary,peer.args.allSatisfy({$0.utf8.count<=4096 && !$0.contains("\0")}),try regularCodeHash(peer.code.binary)==peer.code.sha256,try regularCodeHash(peer.entry.binary)==peer.entry.sha256 else{try deny("PEER_SPEC_REJECTED")}}
 var st=stat();guard lstat(s.workingDirectory,&st)==0,st.st_mode&S_IFMT==S_IFDIR,st.st_uid==getuid(),st.st_mode&0o022==0 else{try deny("WORKTREE_REJECTED")};return s
}
func readInputLine()throws->Data{var data=Data();while true{var byte:UInt8=0;let n=Darwin.read(STDIN_FILENO,&byte,1);if n<0&&errno==EINTR{continue};guard n>=0 else{try deny("INPUT_UNAVAILABLE")};if n==0||byte==10{return data};data.append(byte);guard data.count<=65536 else{try deny("INPUT_TOO_LARGE")}}}
func writeLedger(_ root:String,_ ledger:WorkerLedger)throws{try privateAtomic(root+"/ledger.json",JSONEncoder().encode(ledger))}
func inspectWorker(_ root:String)throws->[String:Any]{
 let spec=try decodeSpec(privateRead(root+"/spec.json")),ledger=try JSONDecoder().decode(WorkerLedger.self,from:privateRead(root+"/ledger.json"));guard ledger.version==1,ledger.jobId==spec.jobId,ledger.specSHA256==sha(try privateRead(root+"/spec.json")) else{try deny("LEDGER_REJECTED")}
 var matches=false;let targetArguments=sha(try jsonData(spec.args))
 if let expected=ledger.worker,let actual=try processSnapshot(expected.pid),sameProcess(expected,actual){
  matches = !actual.running || actual.executable==expected.executable&&actual.codeSHA256==expected.codeSHA256&&actual.argsSHA256==expected.argsSHA256 || ledger.state=="armed"&&actual.executable==spec.code.binary&&actual.codeSHA256==spec.code.sha256&&actual.argsSHA256==targetArguments
 }
 return["state":"quarantined","recordedState":ledger.state,"identityMatches":matches,"mayRestart":false,"signalsSent":0,"reusable":false,"outcome":"unknown"]
}
