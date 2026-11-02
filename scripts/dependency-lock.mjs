import { readFileSync } from 'node:fs';
import { pathToFileURL,fileURLToPath } from 'node:url';
import {dirname,resolve} from 'node:path';
export const dependencyLockMessage='BLOCKED: generate and review a complete official-registry package-lock.json before build, start or database operations.';
function sameMapping(a={},b={}) {return Object.keys(a).length===Object.keys(b).length && Object.entries(a).every(([name,version])=>b[name]===version);}
function validIntegrity(value) {
  if(typeof value!=='string')return false;
  const tokens=value.split(/\s+/);if(!tokens.length)return false;
  return tokens.every(token=>{
    const match=/^(sha1|sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(token);
    return match && Buffer.from(match[2],'base64').length===({sha1:20,sha256:32,sha384:48,sha512:64}[match[1]]);
  });
}
export function assertDependencyLock(root=pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)),'..')+'/')) {
try {
  const manifest=JSON.parse(readFileSync(new URL('package.json',root),'utf8'));
  const lock=JSON.parse(readFileSync(new URL('package-lock.json',root),'utf8'));
  if(lock.lockfileVersion!==3 || !lock.packages?.[''])throw new Error('invalid lock');
  const packages=lock.packages;
  for(const kind of ['dependencies','devDependencies']) {
    if(!sameMapping(packages[''][kind],manifest[kind]))throw new Error('stale lock');
    for(const [name,version] of Object.entries(manifest[kind])) {
      if(packages[`node_modules/${name}`]?.version!==version)throw new Error('unverified direct pin');
    }
  }
  function resolve(parent,name) {
    let base=parent;
    while(base){if(packages[`${base}/node_modules/${name}`])return true;const at=base.lastIndexOf('/node_modules/');base=at<0?'':base.slice(0,at);}
    return !!packages[`node_modules/${name}`];
  }
  const registryVerified=pkg=>validIntegrity(pkg?.integrity) && typeof pkg?.resolved==='string' && pkg.resolved.startsWith('https://registry.npmjs.org/');
  function bundledVerified(path,pkg){
    if(pkg.inBundle!==true || 'resolved' in pkg || 'integrity' in pkg)return false;
    const at=path.lastIndexOf('/node_modules/');if(at<0)return false;
    const parent=packages[path.slice(0,at)],name=path.slice(at+14),declared=parent?.bundleDependencies??parent?.bundledDependencies;
    return registryVerified(parent) && Array.isArray(declared) && declared.includes(name);
  }
  for(const [path,pkg] of Object.entries(packages)) {
    if(!path)continue;
    if(!registryVerified(pkg) && !bundledVerified(path,pkg))throw new Error('unverified registry entry');
    if(Object.keys(pkg.dependencies??{}).some(name=>!resolve(path,name)))throw new Error('missing transitive dependency');
  }
} catch {
  throw new Error(dependencyLockMessage);
}
}
// Pure on import. Callers supply the actual release root when bundled.
