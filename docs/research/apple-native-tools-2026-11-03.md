# Apple native tool reuse assessment

Source inspection on 2026-11-03. This is a source comparison, not native permission, installation, live-data or round-trip acceptance. No alternative tool or Skill was installed. Public source archives were inspected without executing their installers.

## Finding

Use an EventKit adapter for native access and retain the approved LifeOS transaction, merge, lease, durable intent and readback protocol. A CLI/MCP transport or Skill alone does not provide that protocol. Prefer composing a narrowly scoped adapter from an existing public implementation over inventing native CRUD again. CalenCore is the closest source candidate inspected; its remaining limitations must be fixed or rejected before activation. It is not yet adopted or qualified.

## Fixed candidates

| Candidate | Inspected version/source | Useful capability | Decisive limitation / disposition |
| --- | --- | --- | --- |
| [Calen](https://github.com/Aayush9029/calen/tree/60776408e455b3c825aa2d4ccca020652b682ef6) | v0.1.0, `60776408e455b3c825aa2d4ccca020652b682ef6`; MIT | Both entity types, external/local IDs, time zone, detached occurrence metadata, all recurrence selectors and alarms in read DTOs; unchanged/clear/set patches. macOS14+/Swift6. | Reminder dates flatten original DateComponents to Date plus date-only; recurrence write accepts one rule; first-day-of-week lacks a write input; original-occurrence search uses a ±1-day event window and can miss a far-moved exception. Prioritize its DTO/mapping design for reuse, not its CLI as a lossless drop-in. |
| [Che iCal MCP](https://github.com/PsychQuant/che-ical-mcp/tree/f29a468dcd9c4e08a496700a74650aa8b53525ba) | v1.22.0, source commit `f29a468dcd9c4e08a496700a74650aa8b53525ba` (annotated tag object `bdff2fa6d9c28308139fd6e7943b34a14e521ad6`); MIT | Native CLI/MCP, substantial Swift tests, value snapshots and undo/alarm handling. | Internal undo completeness is different from public protocol coverage: ReminderReadSnapshot lacks external/list IDs and modification time; public recurrence write omits several BY selectors/ordinal weekday/WKST. Useful testing/reference patterns; not a complete sync adapter. |
| [ekctl](https://github.com/schappim/ekctl/tree/1c006b9d90650006e370d3854cb9cbc7d8a72cf0) | v1.9.0, `1c006b9d90650006e370d3854cb9cbc7d8a72cf0` | Rich event recurrence/occurrence handling and bundled agent Skill. | No LICENSE file found in the fixed archive; travel time uses an explicitly undocumented KVC property. Do not copy/adopt this source pending license clarification; do not reuse private KVC. |
| [rem](https://github.com/BRO3886/rem) | README screened | Rich Reminders commands | Uses private ReminderKit. Excluded from this public-API bridge approach. |
| [apple-calendar-mcp](https://github.com/Puhavik/apple-calendar-mcp) | README/license screened | Native EventKit and broad RRULE support | GPL-3.0-or-later differs from the current project distribution. Not copied or installed; source reuse needs a separate licensing decision. |

Calen source evidence: `Models.swift`, `EventKitMapping.swift`, `EventKitEvents.swift`, `EventKitReminders.swift`, `Inputs.swift`, `Recurrence.swift` and `docs/eventkit.md`. Che evidence: `ReminderReadSource.swift`, `EventKit/AlarmSnapshot.swift`, `EventKit/UndoManager.swift` and `EventKit/EventKitManager.swift`. Release labels were checked against actual tags rather than trusting stale README version text.

## Skills discovery

Used the skills.sh leaderboard and the MIT [Vercel Skills CLI](https://github.com/vercel-labs/skills) pinned at1.7.6, with read-only searches for `apple reminders`, `apple calendar` and `eventkit`. No `skills add`, broad update or global configuration change was run.

- The most installed Apple Reminders result, [OpenClaw apple-reminders](https://github.com/openclaw/openclaw/blob/main/skills/apple-reminders/SKILL.md), explicitly requires `remindctl`. Installing another wrapper does not restore fields omitted by that binary. Many search hits are copies of this same Skill.
- [swift-ios-skills](https://github.com/dpearson2699/swift-ios-skills) and [apple-skills](https://github.com/Prisma-Labs-Dev/apple-skills) offer EventKit development guidance. They can inform implementation; they are not an installed native executor, sync engine or device identity. Search installation counts and repository stars are discovery signals, not correctness evidence.
- A Skill should describe the bounded LifeOS capabilities and their unsupported operations. The API must enforce registered identity, space, scopes, lease/fence, revisions, idempotency and write gates independently of agent instructions.

## Required adapter qualification

Retain original date/calendar/time-zone components including absent components, complete recurrence arrays and selectors, complete alarms including location/absolute/relative metadata, and native identity/occurrence evidence. Distinguish unavailable observations from known null. Preserve untouched native properties in place. Never infer an occurrence from its newly edited start date, a title or a fuzzy date match.

Before a native save, compare the semantic snapshot and the current writer/lease; after saving, fetch and verify the complete expected result. EventKit notifications are invalidations, not durable server cursors, and a Mac lock does not lock an iPhone edit. An uncertain create remains unresolved until the same immutable operation can be identified; absence alone never authorizes recreating it. Unsupported public-API fields must stay explicit rather than being simulated.

No native adapter is declared lossless until synthetic and permission-scoped native fixtures prove these cases. Full native/business coverage remains OpenSpec task4.2; identity, writer handover, real data, background execution, production and phone/restore acceptance remain task4.3.

## Attribution

If Calen or Che source is later copied/adapted, retain its complete MIT and copyright, pin the exact upstream commit and file hashes, record local changes in `third-party/<name>/`, and update `THIRD_PARTY_NOTICES.md`. Research links alone do not claim source adoption. Existing ReUI/shadcn/TanStack/license evidence remains in the current notices and is not replaced by the project MIT license. A shipped image requires its own actual-content license review.
