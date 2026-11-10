# Cooking Workspace Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. The unified-business-ui OpenSpec task file tracks execution.

**Goal:** Help the signed-in owner choose a dish and follow a verified recipe, then retain a private record of what they cooked.

**Architecture:** The first slice imports public text from a pinned HowToCook release, sends only catalog summaries to the browser and renders the chosen recipe from image-local data. A subsequent typed cooking record can use the existing personal record persistence, source identity, revisions and idempotency. Attachment bytes require a separately verified private storage path.

**Tech stack:** Current Next.js/React, LifeOS theme and controls, existing authentication and record services.

**Spec:** [Cooking workspace](../../../openspec/changes/unified-business-ui/specs/workspace-interface/spec.md#requirement-cooking-workspace) and [Issue #45](https://github.com/Nirvana-Chow/lifeos-app/issues/45).

The catalog slice adds no dependencies, third-party calls at runtime, cookies, grants, record writes or storage settings. Keep unknown times and amounts unknown. The [Cook Skill](https://github.com/YunYouJun/cook/blob/main/skills/cook/SKILL.md) informs the ingredient search workflow; the source is [HowToCook 1.6.0](https://github.com/Anduin2017/HowToCook/releases/tag/1.6.0). Store original attribution and license, exclude upstream media and render the textual recipe safely.

1. Catalog writer owns src/cooking/catalog.ts, catalog data, importer, attribution and catalog tests. Verify ten categories, 357 unique source paths, full sections and deterministic regeneration from the pinned release.
2. UI writer owns src/cooking/workspace.tsx and filter logic/styles/tests. Show a few initial suggestions, change the batch without early repeats, preserve category and ingredient filters when browsing, and render full instructions with a source link. Never present an ingredient match as proof all required items are available.
3. Integration writer owns app/personal/cooking, workspace navigation and route/browser qualification. Reuse the existing principal and PrivacyBoundary on catalog and direct recipe URLs. Test signed-out redirects, unknown recipe IDs, mobile layout and actual filter-to-detail interaction in light/dark. Independently review the combined slice, then follow the exact-source CI and release/readback gates.
4. Record slice: introduce typed date, dish, optional pinned recipe and notes with one owner writer, independent GET readback, isolated cross-owner and lost-response coverage. Scope discovery and Skill ship with the implemented write operation. Keep new live grants and schema activation behind their reviewed authorization boundary.
5. Photo slice: design a bounded private attachment store (Issue #16, #43); accept camera and photo library, make saved state depend on independent same-owner retrieval, and test refusal, retry, storage limits and recovery. No public object or third-party personal data processing. Real iPhone camera acceptance and owner review remain separate.
