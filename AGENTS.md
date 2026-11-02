# LifeOS development

- Keep implementation, test results and user acceptance distinct.
- Use Issue/PR and OpenSpec for multi-step work. Read applicable generated workflows; pin the CLI to 1.16.0 and disable telemetry for automated execution.
- Inspect existing code and native component capabilities before adding dependencies or abstractions. Prefer composition and small adapters.
- Keep one npm lock. Review version updates explicitly.
- Keep credentials, runtime settings, personal records, exports, attachments and backups outside Git. Use explicit synthetic fixtures only.
- Preserve closed defaults, ownership checks, restricted PostgreSQL roles and opt-in integration gates. A skipped integration test is not acceptance.
- Public CI has read-only permissions and no production deployment authority. Do not add production secrets or privileged execution of contributor code.
- Run appropriate checks and obtain independent review for material changes. Report executed, failed, skipped and unavailable verification accurately.
- Retain upstream copyright, LICENSE and NOTICE material.
- Preserve existing work and scope. Do not overwrite another writer, migrate real data or change production trust as a side effect of source work.
