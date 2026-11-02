// No credentials in image ENV/arguments. The approved private file is read only at runtime.
import{assertDependencyLock}from'./dependency-lock.mjs';
import{readPlatformConfig}from'../src/platform/config.ts';
import{readPersonalConfig}from'../src/personal-candidate/config.ts';
import{loadReviewEnvironment}from'../src/platform/private-config.ts';
import{loadControlledStartupEnvironment}from'../src/deployment-candidate/startup-mount-guard.ts';
try{
 assertDependencyLock(new URL('../',import.meta.url));
 for(const key of ['DATABASE_URL','RESTORE_DATABASE_URL','RUN_POSTGRES_TESTS','RUN_PLATFORM_POSTGRES_TESTS','RUN_PLATFORM_AUTH_POSTGRES_TESTS','RUN_PLATFORM_NETWORK_TESTS','LIFEOS_PLATFORM_BOOTSTRAP','LIFEOS_PLATFORM_BOOTSTRAP_APPROVAL','LIFEOS_PLATFORM_BOOTSTRAP_DATABASE_URL','LIFEOS_SYNTHETIC_TOKEN','LIFEOS_SYNTHETIC_MODE'])delete process.env[key];
 const args=process.argv.slice(2);
 if(args.length===0)loadReviewEnvironment('/run/lifeos-platform/runtime.json',process.env);
 else if(args.length===1&&args[0]==='--controlled-mounts-v1')loadControlledStartupEnvironment(process.env);
 else throw Error('Invalid startup arguments');
 process.env.HOSTNAME='127.0.0.1';const platform=readPlatformConfig(process.env),personal=platform?readPersonalConfig(process.env,platform):null;process.env.PORT=personal?.transport==='ssh-loopback'?new URL(personal.baseURL).port:'3002';process.env.NEXT_TELEMETRY_DISABLED='1';
 await import('../.next/standalone/server.js');
}catch{console.error('Isolated review startup unavailable');process.exitCode=1;}
