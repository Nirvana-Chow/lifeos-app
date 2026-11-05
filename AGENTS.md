# LifeOS development

- Keep implementation, test results and user acceptance distinct.
- Use Issue/PR and OpenSpec for multi-step work. Read applicable generated workflows; pin the CLI to 1.16.0 and set `OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 CI=1` for automated execution.
- Continue the approved interface work through the sole mapped [unified-business-ui checklist](openspec/changes/unified-business-ui/tasks.md); preserve its task IDs, inherited status and unfinished rendered/performance/delivery gates instead of opening a duplicate backlog.
- Inspect existing code and native component capabilities before adding dependencies or abstractions. Prefer composition and small adapters.
- Keep one npm lock. Review version updates explicitly.
- Keep credentials, runtime settings, personal records, exports, attachments and backups outside Git. Use explicit synthetic fixtures only.
- Preserve closed defaults, ownership checks, restricted PostgreSQL roles and opt-in integration gates. A skipped integration test is not acceptance.
- Public CI has read-only permissions and no production deployment authority. Do not add production secrets or privileged execution of contributor code.
- Run appropriate checks and obtain independent review for material changes. Report executed, failed, skipped and unavailable verification accurately.
- Retain upstream copyright, LICENSE and NOTICE material, including the fixed ReUI source/provenance and full MIT license under `third-party/reui/`.
- Preserve existing work and scope. Do not overwrite another writer, migrate real data or change production trust as a side effect of source work.

- A newly supported input feature must include its scoped Agent operation, capability discovery and Skill reference in the same delivery. Advertise only implemented capabilities; do not silently widen existing grants or treat a todo credential as whole-system access.
- Synthetic fixtures are internal verification only. Present the actual deployed site and verified records for owner review; report missing real-data access instead of substituting a synthetic preview as delivery.
- Intake precedes implementation: record every actionable owner addition in the single requirements baseline and its existing execution Issue before coding that addition. Deduplicate by behavior, retain a stable ID and source, acceptance, priority, dependencies and current status; then split independently verifiable slices and map them to the sole OpenSpec checklist. New chat input appends to unfinished work. Only an explicit owner cancellation/replacement can remove a requirement. Research and technical review do not mark implementation or acceptance complete.

- Continuous implementation is the default after actionable owner requirements enter the backlog: maintain an iterative overall design, implement and verify routine changes without waiting for per-feature confirmation, and ship usable website slices through the existing review/CI/release gates. Owner feedback can refine the work at any point; owner experience acceptance remains separate. Keep cancelled or paused work paused, and retain concrete authorization for new costs, identity/permission expansion, private-data egress, real migrations, system/background settings and irreversible actions. When continuous execution is explicitly requested, use an actual supported execution mechanism and report its real state instead of promising unbacked background work.

## Parallel delivery and early CI — owner clarification, 2026-11-05

- For independent work, proactively delegate to subagents in isolated worktrees. Declare branch/base, file/interface ownership, dependencies and acceptance before dispatch; keep shared-state changes sequential. Preserve existing drafts and do not let two writers own the same file or Git index.
- Push small reviewable code slices to Draft PRs early so the existing public CI can find problems. Do not wait for every feature or cosmetic detail to be perfect. Mark incomplete or failing checks honestly; early push is not permission to bypass review, fixed-SHA CI, branch protection or production gates.
- While one PR's CI runs, continue the next independent task in its own worktree. Record stacked dependencies explicitly, keep one owner for a failing slice, and fix it without stopping unrelated authorized work. Track exact SHA/run/attempt rather than assuming an old green run applies.
- Deliver usable slices through the existing private release path and read back the actual running version and relevant behavior. Public CI remains read-only and has no production credentials; generating local code alone does not publish a website.
- Keep a short visible checklist in the conversation: completed, current, next and genuinely blocked work. Update it when the current item or priority changes, including preserved old-repository migration and business requirements. A hidden document or an agent message is not the user's progress view.
- The owner subsequently prefers direct pushes of reviewable, locally checked slices to the actual default branch (`main`, referred to as Master in conversation), followed by one complete automatic verification/build/publish/readback pipeline. Root serializes main integration while subagents keep separate worktrees. When branch protection requires PRs, follow that route without an administrative bypass. Do not wait for all features to be perfect before pushing; failed CI prevents publication and retains the previous running version. Automatic public CI and privileged private CD keep separate authorities.
