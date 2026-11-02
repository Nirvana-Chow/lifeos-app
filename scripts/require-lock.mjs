// CLI only; server/library code imports dependency-lock.mjs instead.
import{assertDependencyLock,dependencyLockMessage}from'./dependency-lock.mjs';
try{assertDependencyLock();}catch{console.error(dependencyLockMessage);process.exitCode=1;}
