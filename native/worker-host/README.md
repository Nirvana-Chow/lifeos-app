# Worker host qualification candidate

This source is not installed or automatically enabled. The parent dispatcher,
adopted client and provider qualification are separate prerequisites. No model,
credential provider, HTTP client, system registration or Agent loop lives here.

Build on macOS:

```sh
swiftc -parse-as-library native/worker-host/WorkerHostCore.swift native/worker-host/WorkerProcess.swift native/worker-host/WorkerAttestation.swift native/worker-host/WorkerHostMain.swift -o /an/explicit/private/candidate/path
```

Run only synthetic qualification:

```sh
node --test test/worker-host-admission.test.ts test/worker-host-channel.test.ts test/worker-host-stdio.test.ts
RUN_WORKER_HOST_NATIVE_TESTS=1 node --test test/worker-host-native.integration.test.ts
npm run typecheck
```

The native test creates and removes temporary pinned synthetic executables,
sleep children and intentionally escaped fixtures. It does not invoke Codex,
read auth.json/Keychain or access production. The opt-in is required; a skipped
native test is not cancellation qualification.

## Interfaces

- `run /private/state/JOB_UUID`: first stdin line is the strict WorkerSpec;
  later input accepts only `{"command":"cancel"}`. EOF also cancels. A fresh0700
  job directory is required; existing jobs/worktrees are not silently reused.
- WorkerSpec pins job/requirement/source/digest/fence, runtime SHA/argv, cwd,
  reservedSlots1 and wall/output budgets. `channelPeer` is required for the TS
  launcher. Null is permitted only for native-only synthetic qualification.
- A trusted wrapper waits on anonymous FD19. The original parent atomically
  fsyncs the worker PID/start/group/code/argv ledger before sending a one-byte
  release. Pre-release parent death closes the FD and cannot execute the target.
- `attest /private/state/JOB_UUID`: only the actual parent of this invocation is
  checked against the pinned peer runtime/entry/argv, live worker ancestry and
  job/fence. The peer entry file is an additional pin; complete JS/dependency
  pins still belong to the existing adopted client/NativeCodeGate.
- `inspect /private/state/JOB_UUID`: identity observation only. Always reports
  quarantined, mayRestartfalse, signalsSent0, reusablefalse and outcomeunknown.
  It never adopts, kills or restarts a recovered PID.

Only the original unreaped-child parent signals its owned group. macOS may
return ESRCH from proc_pidinfo for an exited unreaped leader; waitid(WNOWAIT)
keeps that exact child waitable until group cleanup. PID/group/code/argv drift,
hard host crash, unknown result and escaped descendants never authorize a
replacement model or reuse of the old worktree. An observed empty group is not
proof that arbitrary descendants cannot have escaped.

The TS launcher is single-use, uses only the live control pipe to cancel and
discards target stdout/stderr. Even native exit0 returns outcomeunknown and
reusablefalse. The existing business client retains receipt/CAS/readback and
original-request recovery; the four worker tools cannot call operator recovery
or a generic owner writer. Workflow progress replaces only state/purpose/
nextStep after refetching the assigned original record; accepted fields remain
unchanged.

## Still closed before a real worker

`WorkerAdoptionPort` is deliberately unimplemented. Root must supply the
separately reviewed current57-client/pins/fresh discovery, original claim key
and live fence, parent-reserved slot and reviewed CLI/provider/MCP invocation.
Verify the actual default provider is the authorized destination without
reading auth.json, changing global model configuration or enabling paid fast
mode/telemetry. This candidate does not pass HOME/auth environment into targets.
It does not prove real Codex behavior or change global settings.

This is a cooperative same-UID boundary, not a sandbox against malicious local
code. It does not prevent same-UID shell code from invoking some separately
available owner program. No such owner program is delegated through these
four tools, and this source is not evidence of scoped OS credential isolation.
