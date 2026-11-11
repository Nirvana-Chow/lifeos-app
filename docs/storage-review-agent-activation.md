# Private storage-review Agent activation boundary

This source slice inherits PR42's private owner page and native storage writer. It adds `snapshotStorageReviews`, `getStorageReview`, `createStorageReview`, `updateStorageReviewChecklist` and `updateStorageReviewDecision`; see the generated Agent operation reference. Source implementation is not actual activation, uploaded owner data or acceptance.

## Gates

- Native restricted storage and the existing Agent business-policy SQL/readiness must already qualify. `LIFEOS_AGENT_STORAGE_REVIEW=storage-review-v1` additionally requires the existing `LIFEOS_AGENT_ALL_BUSINESS_DATA=all-personal-business-v1` configuration. Neither is set by source installation.
- Proposed0019 inserts five reviewed operation/scope registrations with the existing `enabled=false` default. It requires the exact approved database/owner/space and the owning migration role. It changes no table/function/role grant, old key, policy choice, identity, expiry or business record. It is not run automatically by launch, build or CI against a real account.
- A separately authorized administrator may enable the five exact reviewed registrations after fixed-source qualification. Existing old explicit grants retain only their six-scope language. Only an owner-selected all-personal-business policy can derive the ready `storage-review:read`/`storage-review:write` operations.
- The installed credential runtime/MCP host must match the new route and argument contract. A newer downloaded Skill cannot widen the installed binary, ACL or Key grant. HTTP MCP projects the same registry when its separately qualified endpoint is enabled.

## Data semantics

Snapshot is complete and contains zero or one record. Use returned record/source IDs and revisions, never computed or guessed private IDs. Create supplies only `fields.checklist`; updates require the actual record ID and CAS revision. The checklist contains the owner's existing stable item IDs and its original revision. This task adds no scan.

New checklist revisions preserve decisions for identical item objects. Changing or removing a decided object conflicts until that existing decision is explicitly resolved; replacing a revision never silently clears choices. Protected and processed items remain read-only. A recorded `trash` choice never deletes files or grants permanent-delete authority.

Owner requests keep their original writer/receipt behavior. Agent requests use a current scoped actor and transaction-held grant fence; their immutable history command records server-derived grant/operation audit without accepting those fields from the caller. Source identity remains the native website system that owns the record. Tagged review entries remain excluded from ordinary inbox/journal/source projections.

Every successful command returns its historical receipt (with `duplicate`) separately from an independent current GET. A no-op keeps the prior revision. Unknown outcomes retain the original payload/key; a current snapshot cannot prove an unconfirmed command succeeded. Later revisions, unreadable data and revoked authority remain distinct outcomes.

## Delivery readback still required

No real checklist, account, credential, private file path or owner choice is in this repository. Root owns actual authorized upload of the already supplied checklist, exact count/status/revision readback, production version/endpoint verification and the owner's experience review. Local synthetic tests, proposed SQL and public CI do not replace those gates.
