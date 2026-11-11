# Requirement event integration source qualification

This continues LO-REQ-001/#30 and LO-AGENT-001/#35 on base1b4706d plus the independently reviewed29cf673 event candidate. It is source qualification, not production enablement, owner acceptance or completion of the continuous Goal.

The Agent source now exposes two scoped JSON operations and one separate SSE eventTransports descriptor behind explicit requirements/event activation, restricted schema/ACL/RLS/trigger-source readiness and the existing branded actor/current-grant boundary. JSON and MCP never execute the SSE descriptor. Claim/renew command receipts and fenced original-writer progress retain original payload/key; independent getRequirement returns current record plus enabled execution projection. The native broker remains a separate frozen credential consumer and was not rebuilt or used for real credentials by this slice.

Independent-review P2 was reproduced: separate READ COMMITTED bounds/page queries could miss a concurrent retention gap. Replay now uses one materialized statement snapshot; its regression observed RED then GREEN. The lease row remains locked on the original write connection; wall time is read after lock acquisition. Authorization precedes historical receipt recovery; the lease fence applies only to a genuinely new write, so an expired lease does not force a new key for an already committed command.

Executed locally:

- Full suite: `node --test --test-concurrency=2 test/*.test.ts` —1762 total,1701 pass,0 fail,61 opt-in skips. Bounded concurrency follows the already established local16GB/10-core contention evidence; tests/timeouts were not weakened.
- `npm run typecheck` —pass.
- One root-reserved integration build: `NEXT_TELEMETRY_DISABLED=1 CI=1 npm run build -- --webpack` —pass, Next16.4.1, no new dependency/lock change. Build slot released.
- OpenSpec1.16.0 strict personal-agent-foundation validation —pass with telemetry0/DO_NOT_TRACK/CI.
- Actual reviewed legacy client public source SHA25628939f3719f59a5fe57f3d936cbc5cab6e35b6a9e20eedde63b9a07017fdf474 was loaded with a synthetic in-process fetcher: new event metadata ignored safely; existing requirement create/GET verified; unsupported stream execution refused.1 pass/0 skip. No production host/Keychain/API was executed.
- Focused pipeline exercises actor scopes, JSON/SSE separation, lease/current GET, lost progress after expiry, restarted durable historical claim/GET-only settlement, immediate notification concurrency refusal, abort and bounded unread-stream revocation release. Actual Python JUnit gates reject missing, duplicate, skipped, failed and error cases.

Both qualification workflows now require four named core requirements/event SQL leaves on the same serial source-bound requirements service, plus35 policy/storage/event leaves on the existing separate fresh policy service. Event migration approval GUCs are set/read/applied on one checked-out admin client, with a separate core/SQL/SOURCE_SHA-bound fixture marker. No core-role reset, production URL override or public-CI production authority was added. **The new real PostgreSQL leaves and exact new SHA CI have not run locally and remain mandatory gates.** Prior1b4706d CI success is not evidence for this change.

Remaining work is explicit: independent fixed-tree review and new-SHA CI; existing ordinary-ticket controlled admission (newly inserted planned tickets alone are insufficient for the Goal); production migration/module/grant qualification; reviewed native client/stream adoption; reserved slots (still0), narrow worker capability/channel, orphan/cancellation and real command-readback qualification; actual owner experience acceptance. Candidate/paused/cancelled decisions and engineering/owner-acceptance evidence are not changed. No real records were imported, SQL applied, grant expanded, model run or background service installed.
