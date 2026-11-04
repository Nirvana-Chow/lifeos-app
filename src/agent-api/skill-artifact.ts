import {gzipSync} from 'node:zlib';
import {skillArtifactFiles} from './skill-artifact-content.generated.ts';

/** Deterministic POSIX tar with no filesystem, runtime configuration or session
 * access. Short allowlisted paths avoid extensions and all archive links. */
export function buildSkillArtifact(): Uint8Array<ArrayBuffer> {
  const chunks: Buffer[] = [];
  for (const [path,text] of Object.entries(skillArtifactFiles)) {
    const data=Buffer.from(text,'utf8');
    const header=Buffer.alloc(512);
    const octal=(value:number,length:number)=>value.toString(8).padStart(length-1,'0')+'\0';
    header.write('lifeos-agent/'+path,0,100,'utf8');
    header.write(octal(0o644,8),100,8,'ascii');
    header.write(octal(0,8),108,8,'ascii');
    header.write(octal(0,8),116,8,'ascii');
    header.write(octal(data.length,12),124,12,'ascii');
    header.write(octal(0,12),136,12,'ascii');
    header.fill(32,148,156);
    header.write('0',156,1,'ascii');
    header.write('ustar\0',257,6,'ascii');
    header.write('00',263,2,'ascii');
    const checksum=header.reduce((sum,byte)=>sum+byte,0);
    header.write(checksum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');
    chunks.push(header,data,Buffer.alloc((512-data.length%512)%512));
  }
  chunks.push(Buffer.alloc(1024));
  return Uint8Array.from(gzipSync(Buffer.concat(chunks)));
}
