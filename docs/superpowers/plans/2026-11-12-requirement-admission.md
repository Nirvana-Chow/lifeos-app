# Existing requirement admission

Continue LO-REQ-001/#30, LO-AGENT-001/#35 and personal-agent-foundation from frozen87e628e. Root approved the minimal design in the existing continuous Goal. Business intake/real activation remains root-owned; this source does not claim a business record was saved or an owner accepted delivery.

Use the existing claims POST with explicit `action:admit`, not a new route, broad capability, migration backfill or broker rebuild. Read canonical private UUID/public LO overlay records through RequirementsService in the original transaction. Require current scoped grant and actual source/revision/DB work digest CAS. Read-only execution projection cannot create a virtual overlay or a work row. Preserve original fields, immutable evidence, holds and attempt/fence budgets.

All actions use the same grant/key command advisory lock and durable receipt table. Historical recovery remains behind current grant validation and precedes new-write CAS. New admission takes the same owner/space sequence lock as the trigger, locks current work and commits work/outbox/notification/receipt together. No-op ready work emits no event. Corrupt or uncertain receipts retain the original command. A post-commit authorization/cancellation/readiness loss cannot be described as a rejected new write.

The metadata readiness query and policy-aware JS grant reader use the existing bounded business pool; run them before/after the transaction. Inside, retain cancellation/maintenance guards and enforce fresh current authority with the same-transaction SQL grant fence, without recursively acquiring a business connection. This also repairs the existing progress seam while preserving lease/new-write versus historical-receipt semantics.

- [x] RED: legacy GET returned null execution; explicit admission rejected400.
- [x] Synthetic API tests: UUID/public overlay, virtual baseline, baseline conflict, workflow holds, attempts, no-op, source/revision/digest CAS, rollback, current grant, historical/restarted receipt and GET-only settlement.
- [x] Same-transaction restricted adapter, shared claim/renew/admit key helper, native DB digest projection; no DDL/role/key/setting change.
- [x] JSON schema, semantic receipt/current readback, discovery description and Skill contract in the same source slice.
- [x] Extend the existing isolated PostgreSQL event leaf with real pre0020 legacy records, cross-action concurrent key race, preserved budget, historical receipt and rollback. Keep exact4/35 leaf gates.
- [x] Run applicable focused/full/type/build/OpenSpec checks;1775 total/1714 pass/0 fail/61 opt-in skips; real fixed legacy client1 pass/0 skip. See the admission verification note.
- [ ] Fixed-tree independent review and new-SHA CI (real PG zero skip).
- [ ] Root: production schema/grant/module/runtime qualification, narrow worker channel/orphan/readback evidence, slot reservation and actual owner experience acceptance. Worker slots remain0; no background/model or real business data was used here.
