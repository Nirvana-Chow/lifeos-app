import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {updateSkillBeforeUse} from '../src/agent-api/skill-updater.ts';

// Run only a reviewed local checkout of this file. No command/code is downloaded
// or executed. Paths choose installation/state, never origin/credential/binary.
export async function beforeUse(args:string[]){
  if(args.length!==2)throw Error('usage: node scripts/lifeos-skill-before-use.ts ABSOLUTE_SKILL_DIRECTORY ABSOLUTE_PRIVATE_UPDATE_STATE');
  if(args.some(path=>resolve(path)!==path))throw Error('absolute paths required');
  return updateSkillBeforeUse({skillDirectory:args[0],stateDirectory:args[1],apiVersion:2});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  beforeUse(process.argv.slice(2)).then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(()=>{
    // Fixed error message avoids echoing arbitrary server text/private paths.
    process.stderr.write('LifeOS Skill update failed; business calls stopped. Inspect trusted local update state before retry.\n');
    process.exitCode=1;
  });
}
