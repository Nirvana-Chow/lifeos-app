# Business first versions

Continues the existing intake and Issues5/6/7/11/12/15/30/32/33/35, personal-agent-foundation6.1–6.4/8.1–8.3/9.7 and the sole unified-business-ui checklist. The owner explicitly chose functioning business modules before concentrated visual review. Ordinary source implementation continues without another feature-by-feature approval.

## Existing foundation and boundary

- Base candidate: ecbcf6628afc3384484033a99a75bf0932e68d2c, not yet published. Actual public main/running source at intake: e29c5bf38696531aa84cc77a71e3765a19a8761e. The event-triggered CI/CD path is verified; no periodic polling remains.
- Reuse PersonalService and the existing PostgreSQL entry/history/receipt storage for real owner records; keep the original five allowedTypes and add separate closed module gates. Do not reuse synthetic-only record endpoints as a personal store.
- Health and people add narrow personal metadata validators/forms under independent module directories. Keep complete `{title,text,occurredOn,personal}` fields and source/revision reference pins. Root owns business/config/service/client/router/Agent registry integration.
- Finance reuses the existing validated minor-unit FinanceDraft and mature DraftService transaction writer through a narrow owner/space/source adapter. Preserve refund, transfer and repayment meaning; a transaction total is not an account balance. Do not switch the finance authority or import historical ledgers implicitly.
- Each input delivery includes implemented scoped Agent HTTP operations, matching discovery and generated Skill references. Keep unsupported/readiness-closed capabilities unavailable, existing Key grants unchanged, account/security/payment execution outside the business policy, and owner MFA for key management. A document update cannot grant authority or silently replace a local credential runtime.

## Independent slices and ownership

1. Root: publish existing calendar, journal and requirement-support work with actual route wiring, explicit references, API/Skill parity, fixed source qualification and reviewed private overlay/runtime activation. No raw runtime body leaves the host.
2. Health author: reuse the frozen owner-health source where applicable; deliver typed manual body/training/sleep records and their fields/summary/trend presentation. Preserve actual units, dates, completion and missing-data truthfulness. Source import is a separate adapter; do not claim Apple/Xunji synchronization from a refresh.
3. People author: deliver typed person/contact/birthday metadata, fields and record presentation, with explicit project/domain/topic relations. Do not infer relationships or import contacts. Root binds person references into journals/calendar after the shared writer validates ownership and source/revision.
4. Finance author: deliver owner-only transactions with real list/detail/create/update/history, scoped service/HTTP/client seams and an initial usable page. Reuse existing writer/validator/components; no syntheticOnly flag or invented balance/data.

Each author owns only its module directory and module-specific tests/verification note in an isolated task worktree. No author edits root's shared config, business union, service, generic client, router, scopes/capabilities, generated Skill, OpenSpec checklist, deployment control or Git index. Root serializes those integration changes and main publication. Use public Git author/committer identity; keep private inputs outside Git.

## Verification and delivery

For each slice, test meaningful schema/owner/CAS/idempotency/reference and failed-readback behavior, then exercise its actual rendered first-version flow with explicit internal fixtures. Reuse existing dependency locks and valid evidence. Integrate once, run necessary type/contract/default and enabled persistence checks, obtain independent review, and let fixed-SHA CI block failed publication. Do not call skipped integrations passed. Publish usable slices without waiting for every other feature; read actual source/build and available module behavior after automatic CD.

The owner reviews the real deployed pages. No screenshot of synthetic personal records is delivered as the result. Health/finance/people modules with no authorized records show an honest empty state and working input. Real task classification, original-repository migration, external synchronization and later personal Agent work retain their unfinished status and their concrete authorization boundaries.
