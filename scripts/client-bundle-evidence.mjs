import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,constants} from 'node:zlib';
import {pathToFileURL} from 'node:url';

// Inventories every JS file in Next's client static tree once by path. It is
// not a route transfer estimate: chunks may be shared or loaded on demand.
export function collectBundle(root,sourceSha){
 if(!/^[0-9a-f]{40}$/.test(sourceSha))throw Error('invalid source');
 const regular=path=>{const st=lstatSync(path);if(!st.isFile()||st.isSymbolicLink())throw Error('not a regular file');return readFileSync(path);};
 const proof=JSON.parse(regular(join(root,'.image-source-proof.json')).toString());
 if(proof.sourceSha!==sourceSha||!/^[0-9a-f]{64}$/.test(proof.sourceTreeDigest))throw Error('source mismatch');
 const locks=Array.isArray(proof.files)?proof.files.filter(file=>file.path==='package-lock.json'):[];if(locks.length!==1||!/^[0-9a-f]{64}$/.test(locks[0].sha256))throw Error('missing locked dependency proof');
 if(createHash('sha256').update(regular(join(root,'package-lock.json'))).digest('hex')!==locks[0].sha256)throw Error('lock proof mismatch');
 const buildId=regular(join(root,'.next/BUILD_ID')).toString().trim();if(!/^[A-Za-z0-9_-]{1,128}$/.test(buildId))throw Error('invalid build id');
 const base=join(root,'.next/static'),files=[];
 function walk(relative){const directory=join(base,relative);const stat=lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('invalid static directory');for(const name of readdirSync(directory).sort()){if(!/^[A-Za-z0-9_.\[\]()-]+$/.test(name))throw Error('invalid static path');const path=relative?relative+'/'+name:name,absolute=join(base,path),item=lstatSync(absolute);if(item.isSymbolicLink())throw Error('static symlink');if(item.isDirectory())walk(path);else if(item.isFile()&&name.endsWith('.js')){const data=regular(absolute);files.push({path,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),gzipBytes:gzipSync(data,{level:9,strategy:constants.Z_DEFAULT_STRATEGY}).length});}else if(!item.isFile())throw Error('invalid static entry');}}
 walk('');if(!files.length)throw Error('empty client bundle');
 return {version:1,scope:'all .next/static/**/*.js, unique paths; not route transfer size',sourceSha,sourceTreeDigest:proof.sourceTreeDigest,lockSha256:locks[0].sha256,buildId,compression:'gzip level=9 strategy=Z_DEFAULT_STRATEGY, per file, node:zlib',nodeVersion:process.versions.node,zlibVersion:process.versions.zlib,files,totalBytes:files.reduce((n,f)=>n+f.bytes,0),totalGzipBytes:files.reduce((n,f)=>n+f.gzipBytes,0)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log('CLIENT_BUNDLE_EVIDENCE '+JSON.stringify(collectBundle(process.argv[2],process.argv[3])));
