# Device sessions and business MCP integration

Requirements: LO-AGENT-001 / LO-SEC-001. Candidate source only; not production activation or owner acceptance.

This integration consumes the independently reviewed device-session implementation through public commit `370e9b2a4d0e0c7c09b8326db0edf6b6982a52ce`. Its original migration qualification remains the fixed 191118 packet; the later SQL comment change preserves every executed function body. The storage-note dependency retains its fixed revision/CAS correction.

The strict startup loader admits only the optional `LIFEOS_PERSONAL_SESSION_DURATION=native-device-v1` in an already valid personal binding and removes inherited enablement when omitted. Unknown keys remain rejected. The private projection changes only the existing reviewed database-name literal; it does not read runtime configuration.

Business-policy, OAuth and file readiness accept their original exact function digests or the corresponding exact reviewed 0024 body. Existing ownership, restricted-role, ACL, trigger and registry checks remain in force. The new session mode still separately requires `verifySessionDurationPool` and its hardened freshness bodies; legacy compatibility is not new-mode readiness. Historical SQL files and legacy fingerprint exports are unchanged.

OAuth pages distinguish a usable ordinary owner session from fresh MFA. A stale confirmation redirects to the existing reauthentication entry with the original signed query. The exact outer `oauth_query` plus `reauthenticate=1` envelope is unwrapped; arbitrary extra keys are not silently removed. A definite HTTP 401 `OWNER_MFA_REQUIRED` returns to that same entry before provider dispatch. Unconfirmed writes remain unknown and are never automatically repeated.

Validation: the missing startup behavior, readiness bindings and signed-query envelope each reproduced RED before the minimal change. The combined focused run passed 67 tests without skips; type checking passed after fixing a test-only optional-argument error. The actual login route and page-state execute with the official signature verifier in the focused route test. Native authentication uses the original synthetic memory adapter; HTTP owner rejection uses the actual OAuth handler.

The original complete Node test directory also passed: 2436 cases, 2341 passes, zero failures and 95 explicit opt-in skips. These skips include PostgreSQL, browser and native-environment gates and are not acceptance.

Pending: the new readiness queries need real restricted PostgreSQL execution, including unreviewed-body/ACL rejection; route execution is not real-browser acceptance. A fresh full production build and same-output checks must bind the eventual fixed public/private source. The new private 15-source combination, source-profile adoption, original fixed-main CI/publication and real ChatGPT/phone/offline acceptance remain separate gates. No production schema, flags, source profile, credentials or account grant changed in this source slice.
