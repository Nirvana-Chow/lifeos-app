# Agent Runs

## Purpose

Provide durable and bounded assistant runs whose progress, waits, cancellation and recovery are visible without granting checkpoint or worker state business authority.

## ADDED Requirements

### Requirement: Controlled engineering execution preserves current work

Engineering scheduling SHALL register existing Goals/manual/subagent occupancy before admission and run only approved dependency-ready tasks. Ordinary programs SHALL schedule/heartbeat/retry/sync without idle model calls. One bounded task SHALL have one valid executor; parallelism requires separate accepted subtasks. Retries/device changes SHALL retain new attempts with prior evidence.

#### Scenario: An execution environment is added

- **WHEN** Mac, server Codex or Cloud is connected
- **THEN** start/resume/status/cancel/result are each verified, dot remains a candidate until tested, and attempts retain task/content version/device/session-or-cloud-task/workspace/branch/state/results

#### Scenario: A current primary Goal already owns work

- **WHEN** controlled scheduling is enabled
- **THEN** its ownership and capacity are preserved rather than claiming, interrupting or duplicating the same broad Goal

### Requirement: Capacity and loss of contact are fenced

Capacity SHALL reflect actual load/current occupancy and reserved unknowns, with task/subagent/build-test/model limits and production reservations. Workspaces MUST NOT replace task locks or shared-resource coordination. Offline devices SHALL receive no new tasks. Invalidated executors SHALL be unable to update progress, merge or publish. Reconnect reconciliation, pause, drain and safe cancellation SHALL be supported.

#### Scenario: Devices compete for a build or execution slot

- **WHEN** a new task would exceed measured or reserved capacity
- **THEN** it waits without affecting the existing website/database; the scheduler does not infer capacity from device count or ignore manual tasks and shared ports/databases

#### Scenario: A disconnected executor's lease expires

- **WHEN** the server has not established the old process and result outcome
- **THEN** it holds takeover for reconciliation and does not run a second copy on another device

### Requirement: Requirement changes have explicit adoption

Material content changes SHALL persist a new content version/change event and notify the existing executor. Saved, pending delivery, pending acknowledgment and adopted SHALL be distinct; the executor SHALL record its adopted version at safe checkpoints. Unaffected work may continue, but delivery SHALL recheck current content and refuse completion against unhandled changes. Progress and notification acknowledgments MUST NOT create new admission.

#### Scenario: An owner changes an in-flight task

- **WHEN** the current executor has not adopted the new content version
- **THEN** the change remains visible as unhandled and old-version work cannot be declared complete or dispatched as a duplicate task

### Requirement: Engineering delivery includes development-environment production build

Functional source SHALL pass applicable types/tests and a full production build with same-output checks in its qualified development environment before PR/CI/CD. Heavy builds SHALL queue; only unchanged source/dependency/environment evidence may be reused. Fixed-main checks/artifacts, serialized publication, failed-release protection and runtime readback remain mandatory. Documentation-only edits receive appropriate checks.

#### Scenario: The current environment lacks build resources

- **WHEN** the Mac, isolated server or cloud workspace cannot build safely
- **THEN** validation moves to a qualified isolated environment rather than skipping, and changed source/dependencies/environment invalidate prior evidence

#### Scenario: A development build fails

- **WHEN** the prepared delivery source fails its production build
- **THEN** it is repaired and reverified before entering the release path; a later CI build is not substituted for that missing result

### Requirement: Runs expose a bounded observable lifecycle

A run SHALL bind a goal, source selection, authority and policy versions, model configuration and explicit limits. The website SHALL expose actual stage, evidence/proposal counts, wait/failure reason and receipts without internal model thoughts or invented progress percentages. Initial limits SHALL be20 nodes,6 model calls,20 read/preview tools and ten active minutes unless a stricter approved policy applies.

#### Scenario: A run reaches its node limit

- **WHEN** the next node would exceed the fixed run limit
- **THEN** the run stops before that node and reports the reached limit with its recoverable state

### Requirement: Durable state is private and authority guarded

Checkpoint read, list, stream, resume and deletion SHALL verify server-side run-to-owner/space binding and current authority. Guessing a thread or run identifier MUST NOT disclose state. Checkpoints SHALL contain bounded work state and evidence references rather than secrets or an unreviewed permanent fact store.

#### Scenario: Another owner guesses a checkpoint ID

- **WHEN** a foreign owner requests the checkpoint or its stream
- **THEN** no state, evidence or existence metadata is disclosed

#### Scenario: An old checkpoint is resumed

- **WHEN** a checkpoint references expired producer authority or an incompatible graph schema
- **THEN** the run pauses safely rather than restoring stale permissions or replaying committed actions

### Requirement: Worker delivery does not duplicate effects

At-least-once jobs SHALL use per-run serialization, current authority, stable command identity and existing business receipts. Waiting for review SHALL persist state and release the job. Worker jobs MUST NOT approve or commit, and replay or branching MUST NOT reapply past business effects.

#### Scenario: Worker crashes after recording a proposal

- **WHEN** the same job is delivered again after restart
- **THEN** it resumes the same run and proposal or receipt without creating duplicate business writes

### Requirement: Model costs are reserved before calls

A real model call SHALL require authorized data egress, active tested configuration and an atomic worst-case budget reservation. Missing cost policy SHALL prohibit the call. Unknown provider usage SHALL remain conservatively reserved and visible; graph, SDK and worker MUST NOT stack independent retries.

#### Scenario: Two jobs compete for the remaining budget

- **WHEN** concurrent jobs would exceed the available run budget
- **THEN** only the reservable call proceeds and the other stops before sending data

#### Scenario: Provider response is lost

- **WHEN** a model call may have incurred cost but usage is unknown
- **THEN** the system records unknown settlement and does not assume the call was free or automatically issue another paid call

### Requirement: Cancellation and errors preserve truthful outcomes

Cancellation SHALL stop new calls and tools, preserve existing receipts and expose any uncertain effect. Logs and streams SHALL omit secrets, raw private prompts/state and unsanitized provider errors. Closing the website SHALL NOT silently cancel or erase a durable run.

#### Scenario: Owner closes the browser during a run

- **WHEN** the owner returns from another client with current authority
- **THEN** the same persisted run state is available rather than a fabricated new run or completion

### Requirement: Runtime activation remains explicitly qualified

New worker processes, database schemas/roles, model egress and persistent settings SHALL remain disabled until their concrete activation package is authorized and qualified. Public CI SHALL exercise synthetic isolated behavior without production credentials or real private model calls.

#### Scenario: Runtime flag is absent

- **WHEN** the default application starts without Agent run activation
- **THEN** no worker is launched, no graph migration runs and no real model request is made
