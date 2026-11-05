# Business module integration candidate

Continues Issues6/11/12/15/30/32/33/35 and the original OpenSpec checklists. Source integration is not production activation or owner acceptance.

- Calendar now reaches its existing owner workbench. Journal, people and health use the same native PersonalService writer, reference locks, source pins, revisions and idempotent receipts; finance routes to its narrow DraftService adapter. Original five allowed types remain unchanged; new owner module flags are separate and closed by default.
- Journals preserve legacy records while optionally linking current project/domain/topic/person revisions. New record inputs use a frozen recoverable command and require independent individual GET plus current owner/space status before clearing it. Visibility changes hide private content; unsent edits restore only under the same verified owner/space.
- Shared LifeOS chrome exposes only verified available owner modules. Business content uses the available content area, a quiet ReUI grid and modal details. Legacy editor routes remain compatible.
- Agent parity is implemented separately in the same candidate: five scoped record types and feedback, explicit business policy, exact readiness/fences and generated portable Skill contracts. Existing deployed Key grants and the local credential runtime are unchanged.

Executed integration checks: eight service/client/navigation tests passed; twelve Agent/Skill/readback tests passed; TypeScript passed. Native Chrome disposable fixture exercised journal/person/health create, independent readback, detail/edit, hidden-state privacy, unsent edit restoration, refresh/history and desktop-light/mobile-dark geometry: one test passed across six scenarios, no page errors or horizontal overflow. Fixtures stay internal.

Remaining: independent integration review, finance rejection recovery fix, direct MIT training dashboard reuse, final fixed-SHA CI/build, reviewed private config overlay and owner flag activation, event CD/runtime readback. External Xunji/Apple ingestion, actual task classification, original-repository migration and owner experience acceptance remain incomplete.
