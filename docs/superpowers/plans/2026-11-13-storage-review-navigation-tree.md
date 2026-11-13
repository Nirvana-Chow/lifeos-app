# Storage review navigation and directory detail implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline; Root arranges independent review and delivery. Do not delegate further.

**Goal:** Make the existing owner storage-review page discoverable and let exact dotted child IDs be reviewed separately without resetting historical choices or implying file deletion.

**Architecture:** Keep the existing protected server HTML page and save/CAS/receipt/readback flow. Project the already available storage service in owner status; reuse the module map and settings navigation. Build a presentation-only tree from exact existing dotted parent IDs, retaining original records and choices. A parent with children is read-only; standalone folders remain selectable.

**Tech stack:** Existing Next.js/React/TypeScript, native HTML details, existing Lucide icons; no dependency, schema, config or grant changes.

**Spec:** Existing unified-business-ui workspace-interface specification, 1.2/3.1/3.2 and storage-review acceptance, Issue #41 / LO-FILES-001 / LO-UI-001. This plan is engineering mapping, not a business progress ledger.

## Constraints and design choices

- Reuse the current page rather than creating a second review table or schema. Native disclosure keeps keyboard support without a tree-widget dependency.
- Parent identity is the exact last dotted prefix when that record exists and both IDs have nonempty safe segments. Orphans remain independent records; no renumbering or record mutation.
- Parent choices remain visible as historical choices. Only pending leaves count toward the current choice progress. Protected/processed states remain distinct from decisions.
- Upload completion and independent restore verification have no structured fields in this contract. Show them as unverified for media, retain the original body, and never infer completion from body keywords, names or a trash choice.
- Preserve owner/MFA/no-store, unknown command recovery and the existing Agent operation/discovery/Skill contracts. No file action or actual-record access.
- Root owns private intake, real child records, source allowlist, independent review, PR integration, fixed-main CI/release/readback and owner acceptance. Do not change the sole OpenSpec checklist or call the parent requirement complete.

## Implementation and verification

- [x] Add failing behavior tests for exact gated navigation/status, dotted identities, parent write protection, leaf filtering/counts, historical choices, unknown media evidence and malformed/orphan IDs.
- [x] Make the smallest navigation/status and existing-page presentation changes; preserve current save/auth/recovery behavior. New return links block leaving while a request is busy, pending or uncertain.
- [x] Run focused tests and TypeScript. Reserve the full default suite/build for Root's fixed-main pipeline under the delivery agreement.
- [x] With Root's exclusive browser slot, extend and run the existing isolated synthetic browser fixture for route/expand/filter/keyboard/mobile/save/recovery. No repeated aesthetic captures.
- [x] Report fixed code SHA, source copy for finite allowlisting, exact checks and pending independent/production/owner gates.

## Browser fixture diagnosis (three attempts retained)

1. **Target:** LO-FILES-001 / LO-UI-001 owner navigation, settings tool discovery, directory detail and preserved save/recovery; no production or owner acceptance claim.
2. **Evidence:** 25 focused checks and TypeScript passed. Existing isolated storage HTTP/Chrome fixture passed at 1920/1365/390, including directory/leaf state and recovery. Next attempts reached progressively later assertions; all three cleaned browser/server/temp root successfully.
3. **Boundary:** The owner-module fixture copies the real workspace but hand-authors its Page. First it expected an obsolete release title/count; next it expected product links in the old mobile navigation location; finally its direct settings query loaded a Page that never passed initialPage to the workspace.
4. **Attempts:** #1 preserved the old title assertion and failed before navigation. #2 tested one current heading with nonempty changes and failed at the old navigation placement. #3 followed the actual Settings button and successfully checked calendar/storage navigation plus all four settings links, then failed at a redundant direct query visit. No production code was changed to satisfy those assertions.
5. **Supported cause:** app/personal/page.tsx parses readWorkspaceLocation and supplies initialPage/panel; src/personal-candidate/live-workspace.tsx also uses syncUrl. The fixture supplied neither. The captured browser tree showed Overview after the direct query, while the preceding real Settings-button navigation passed. This disproves a missing tool-link hypothesis; query propagation remains a fixture gap.
6. **One minimal action:** Pass the same readWorkspaceLocation-derived initialPage/panel into the fixture Page. Re-run the original owner-module case once, under Root's exclusive browser slot; success requires every assertion and cleanup to pass. A further failure retains the count and returns to diagnosis without another product change.

## Author verification checkpoint

Code commit: `ec19fcfe4806da5a71cb4ee3f1555a116b48828f`; stacked base: `a1739b9ef1c22c6f551783280cacc2679edd8dce`. No dependency installation or lock change; reused a local dependency symlink after matching lock SHA-1 `e99ae360f1c9673c0775fe065f5b28df9b2a55f9`.

- `node --test test/storage-review-ui.test.ts test/storage-review-navigation.test.ts test/storage-review-route.test.ts test/owner-modules.test.ts test/workspace-hierarchy.test.ts test/storage-review-http.test.ts test/storage-review-service.test.ts test/storage-review-agent.test.ts test/storage-review-isolation.test.ts`: **52 passed, 0 failed, 0 skipped**. New behavior observed RED before implementation; existing auth/CSP/owner/Agent/CAS/unknown-command regressions retained.
- `npm run typecheck` and `git diff --check`: passed. No lint script is configured.
- `RUN_OWNER_MODULE_BROWSER_TESTS=1 ... node --test test/owner-module-navigation-browser.integration.test.ts`: final **1 passed, 0 failed, 0 skipped** after the documented three fixture failures. Verifies mobile main navigation, Settings tools/product links, exact unavailable-service hiding, current release notice and unknown-close retry/readback. Cleanup reported browser/server stopped and temp root removed with no failures.
- `RUN_STORAGE_REVIEW_BROWSER_TESTS=1 ... node --test test/storage-review-browser.integration.test.ts`: final **1 passed, 0 failed, 0 skipped**. Reused the original synthetic HTTP/Chrome fixture at 1920/1365/390 with nine scoped PATCH requests. Verifies child append without resetting a historical parent choice, parent read-only controls, exact child writes, pending/selected filtering, leaf progress, unknown media evidence, keyboard disclosure, mobile overflow, return-link unknown protection, conflicts and separate-session readback.

Native installed Chrome was used. No screenshots, real files/records, running-account acceptance, migrations, grant changes or publication were performed. Full default suite/build, finite private-capture source allowlisting, independent technical review, PR integration, fixed-main release/readback and owner experience acceptance remain Root's gates. This bounded checklist UI does not provide a paged complete-device inventory or establish all storage work complete.

## Finite source-copy handoff

- `src/ui-review/owner-modules.ts`: `存储审核`; exact route `/personal/storage-review`; exact advertised flag `storageReviewEnabled`.
- `src/ui-review/workspace-hierarchy.ts` and the narrow Settings group in `workspace.tsx`: `资料与工具`.
- The existing protected document adds `返回 LifeOS`, `← LifeOS 主站`, `设置与工具`, `已选决定，不代表已执行`, `父目录仅作索引，请逐项审核子项`, `上传完成：未核实 · 独立恢复核验：未核实` and `请先确认保存结果或放弃待确认的输入，再返回 LifeOS。`.
- Dynamic presentation composes only existing item text and fixed labels: `父目录 · `, `历史选择：`, `（不代表已执行）`, `请展开后逐项决定`, `已选：`, `尚未决定`, `删除候选 · 待处理`, `子项（…） · 展开／收起`, and `独立项／子项：留 … · 删除候选（待处理） … · 暂缓 … · 父目录历史选择 …`.
- Footer copy: `审核选项只记录决定，不会删除文件。父目录保留历史选择，展开后逐项审核；选择删除候选表示待处理，不代表已删除。媒体上传与独立恢复核验须另有证据。可导出 JSON 留存。`

## Independent review repair — 2026-11-14

The original independent review returned C0/I3/M0: I1 missing local-persistence failure confirmation; I2 unknown-command exit dead end; I3 weakened current-release DOM oracle. These are open until the repaired source is independently checked; prior author/browser evidence is retained above rather than treated as approval.

Product/test candidate `fedffefd4ad07080400edc9c6a07b73f5488ad90` adds explicit confirmation before abandoning a memory-only local choice, verified owner/space-scoped session command retention before sending, explicit retained-request return/login, same-scope restore without automatic submission, late-generation rejection, and complete `currentReleaseSummary.title`/`changes` DOM expectations. An unretained new request is an unsent draft and emits zero mutations. Unknown commands are kept rather than discarded, with original URL/method/body/key unchanged; POST checklist writes use the same retention path. No new server operation, scope, grant, config or dependency is introduced.

Focused repair check: **61 passed, 0 failed, 0 skipped**, including owner-release-notice; TypeScript and diff check passed. This includes RED→GREEN I1/I2 counterexamples, frozen-command scope/malformed-record checks, retained POST matching, no-wire persistence failure, unknown keep, generation fencing and original CAS/receipt/replay protections. The repaired browser cases are not yet qualified at this checkpoint.

### Repair fixture diagnosis — three attempts retained

1. **Original target:** validate the three review fixes in the original two synthetic fixtures, preserving exact command recovery and source-content oracles.
2. **Verified scope:** the 61 focused checks/types passed; the repaired storage browser progressed through the original directory and save/recovery cases, but its newly added unknown-return injection has not passed. The owner-module browser has not started because the sequential command stopped at storage failure.
3. **Boundary:** native Chrome fetch retries a PATCH when the synthetic HTTP server destroys the response connection after committing. The case expects unknown but Chrome can receive the original idempotent receipt on its retry.
4. **Attempts:** #1 found the old cancellation counter sampled before the disabled button's busy period completed; waiting for the button enabled fixed that path. #2 reached the new return case and found the same early-counter assumption; the request count moved from 9 to 11 before the wait completed. #3 waited for the terminal state and captured a confirmed-receipt DOM state, proving that connection destruction is not a reliable unknown-outcome injection. Browser/server cleanup completed after each run. No product mutation semantics were changed to make the assertion pass.
5. **Supported cause and remaining uncertainty:** multiple PATCH observations plus the confirmed-receipt UI support a native transport retry, rather than a return-link submission. The unknown-path VM tests still replay only the exact original command; the browser fault must produce a deterministic missing receipt to verify the requested state.
6. **One proposed minimal action:** replace only the post-commit connection destruction with a deterministic HTTP 503, retaining the committed service write and every unknown/zero-after-exit/exact-body-key assertion. Re-run this same case once; if it fails, retain the count and return to read-only diagnosis. Do not change product behavior or relax the oracle.

Root accepted that single fixture action. The injected 503 contains no usable receipt and is not treated as confirmation; the browser case still demands unknown, no mutation on leave/restore, exact original body/key retry, owner isolation and the later server choice. The prior two sampling fixes wait for the existing busy-disabled control to settle before counting mutations; they do not loosen the counter assertions.

The separate two-line product copy correction distinguishes a busy new command (`正在提交并核对原请求`) from a retention-failed unsent draft (`尚未发送`), and no longer calls an unsent draft an unknown server result. It changes no request/outcome classification or mutation behavior.

Read-only follow-up for the original reviewer: a known 409 rejection followed by failed GET can still leave `uncertain=true` after explicit discard removes the rejected pending input. Review that safe-return boundary separately; the approved 503 fixture action does not change it or establish I2 closed.
