# Business MCP parity implementation plan

> Agent execution: use the existing inline execution and verification workflow; no descendant agents. Root may provide short independent review.

**Goal:** Make reviewed and explicitly authorized personal business available through the shared Agent API/MCP/Skill contract, preserving narrow grants and protected boundaries.

**Architecture:** Keep the original writer, official OAuth/MCP SDKs, transaction fences and independent readback. Derive MCP exposure from the API registry and add explicit full-policy consent/fencing without rewriting historical migrations.

**Stack:** Existing Node24, TypeScript, Better Auth1.7.23, MCP SDK2.4.0, PostgreSQL17.11; unchanged lock and dependencies.

**Spec:** [Business MCP parity](../specs/2026-11-14-business-mcp-parity.md).

- [x] Integrate fixed storage-note dependency, reproduce the exact shared HTTP/schema/readback failure, add minimal routing/schema/Skill and0026 registration, and pass focused tests/types. Commit this slice separately for the notes track.
- [x] Add registry exposure and full-policy tests covering existing narrow grants, future reviewed operations, unavailable modules, wrong original policy, protected IDs and dedicated file permissions; observe RED before implementation.
- [x] Implement the minimal policy codec/intersection, consent/managed-client projection and0025 transaction fence with source-parity checks. Preserve original0021 and basic1958 evidence. Bind full-policy classification preview in the original transaction without changing the old plan/validator/wire; observe the original revoked/rebound producer counterexamples first. SQL qualification remains open.
- [x] Consume the login track's fresh-MFA contract; preserve signed OAuth continuation across reauthentication and test actual401 handling.
- [ ] Run meaningful focused tests/types, one qualified full production build and same-artifact checks for the final changed app source. Serialize heavy builds with the other tracks.
- [ ] Qualify new SQL against the marked isolated PG fixture; qualify runtime source and Caddy with their actual restricted facilities. Independently review fixed source and evidence.
- [ ] Use ordinary feature PRs and the original fixed-main CI/private Native release path; verify actual source/build, HTTPS, permissions, save/update/readback and unknown recovery. Continue to real ChatGPT/Mac/phone/offline acceptance without calling CI or adoption owner acceptance.

No new dependency, daemon, scheduler, credential export, production-data fixture or permission widening by inference. Keep SQL writer, deployment writer and each shared source file singular; preserve all earlier failed/unknown and partial evidence.
