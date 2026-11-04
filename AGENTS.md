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
