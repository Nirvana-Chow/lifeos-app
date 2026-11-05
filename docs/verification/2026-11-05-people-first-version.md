# People first-version leaf

Continues LO-PEOPLE-001/[Issue32](https://github.com/Nirvana-Chow/lifeos-app/issues/32), LO-LINK-001/[Issue33](https://github.com/Nirvana-Chow/lifeos-app/issues/33) and personal-agent-foundation6.1 under the existing [parallel plan](../superpowers/plans/2026-11-05-business-first-versions.md). This leaf starts at f0fb029506c9c3857a26763854b04b21070b5a38. It does not complete those Issues, OpenSpec tasks or owner acceptance.

## Contract and reuse

- `src/personal-people/model.ts` exports `PersonPersonal`, `PersonPersonalFields`, `PersonReference`, `PersonLinks`, `emptyPersonPersonal()` (fresh blank metadata), `validatePersonPersonal`, `normalizePersonPersonalFields` and `personPersonalReferences`.
- Complete fields are `{title,text,occurredOn,personal}`. Title is the person's display name; identity stays the existing record ID. Missing fields are rejected. Optional contacts remain explicit null. Aliases are trimmed, empty lines omitted, and case-insensitive duplicates rejected (at most20, each240 characters). Phone max80; email max254 with a basic address-shape check; company and relationship max240. Text max16384; title max240.
- Birthdays use Gregorian civil dates. `birthdayOn` is a valid YYYY-MM-DD, or `birthdayMonthDay` is a valid MM-DD including02-29; both cannot be set. Unknown years and ages are never derived. `occurredOn` stays a separate nullable record date.
- Explicit project/domain/topic references preserve ID, sourceId and revision. Topic references are unique, max20. Root must connect these references to the existing PersonalService owner/type/source/revision transaction checks; this leaf grants no authority.
- `PersonFields({value,onChange,disabled?,options:Record<string,PublicEntry[]>})` reuses `RelationFields` and existing form controls/styles. Editing either birthday precision clears the other precision. The root owns the surrounding name/body/date form, confirmation, save/retry/unknown/CAS and readback lifecycle.
- `projection.ts` exports `personBirthdayLabel`, `personSummary` and `projectPeopleEntries(entries,spaceId,search='')`. Rows retain `{id,sourceId,revision,title,fields,summary,entry}`; `entry` is the original PublicEntry. Search uses saved names/aliases/contact/company/relationship/text/date fields. Empty input remains empty. Projection is only for an already authorized service response, not an authorization boundary or a claim of complete source coverage.
- Reused source: `calendar-candidate/personal-domain.ts` for date/complete-field/reference contracts and `personal-candidate/relation-fields.tsx` for pinned target selection. [React19.3 input documentation](https://react.dev/reference/react-dom/components/input), read2026-11-05, confirms controlled value/onChange and associated labels. Existing React19.3.0/TS6.0.2 lock is reused; no dependency installation or update.

## Executed checks

- RED: domain/projection tests first failed with missing implementation assertions (7 failed,1 passed); fields tests first failed with missing component assertions (2 failed). An added non-string alias regression then failed before the string-only guard was added.
- GREEN: `node --test test/personal-people-domain.test.ts test/personal-people-projection.test.ts test/personal-people-fields.test.ts` —10 passed,0 failed,0 skipped. Covers unknown-year/leap birthday dates, complete fields, invalid input, pinned references and limits, empty search, same-name identity, provenance/space filtering, rendered optional/disabled controls and birthday edit transitions. Fixtures are explicitly synthetic and internal.
- Source types: `node_modules/.bin/tsc --ignoreConfig --noEmit --incremental false --skipLibCheck --strict --types node,react --target ES2022 --module esnext --moduleResolution bundler --jsx react-jsx --esModuleInterop --allowImportingTsExtensions src/personal-people/model.ts src/personal-people/projection.ts src/personal-people/PersonFields.tsx` — exit0. Earlier invocations required the TS6 `--ignoreConfig` switch and explicit node types; those command-configuration errors were corrected without dependency changes.
- `git diff --check` — passed before commit.

## Outstanding integration and delivery

The coordinator owns central business/config/PersonalService/client/router/owner UI, scoped Agent operations/discovery/Skill, OpenSpec tracking and publication. It must independently review this leaf and connect the real writer's ownership/type/current-pin, CAS/idempotency/history and failed-readback behavior. Root performs the combined source/contract suite, actual rendered owner flow, enabled PostgreSQL checks, build, fixed-SHA CI, CD and running-version readback. These were not repeated or claimed by this leaf.

No production API, credentials, contacts, external personal information, host configuration, data migration or push was accessed. No contact import, relationship inference, email delivery or birthday-year inference was added. Empty deployed modules must show an honest empty state. Real-data access, confirmed backward relations and owner experience acceptance remain unverified until the integrated delivery.
